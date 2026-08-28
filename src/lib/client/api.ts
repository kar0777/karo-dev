'use client';

// The leaf module, not `@/lib/api/csrf`: that one verifies tokens, so it reaches
// the session and the database, and importing it here would bundle both.
import { CSRF_HEADER } from '@/lib/api/csrf-header';
import type { AgentStreamEvent } from '@/lib/types/agent';

/**
 * The browser-side API client.
 *
 * One place that knows how Karo talks to itself: it attaches the CSRF header to
 * every unsafe request, unwraps the `{ error: { … } }` envelope into a typed
 * exception the UI can render directly, and gives SSE the same ergonomics as a
 * normal fetch.
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly title: string;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(init: {
    code: string;
    title: string;
    message: string;
    status: number;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.title = init.title;
    this.status = init.status;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.status >= 500;
  }
}

let csrfToken: string | null = null;

/** Set once by `SessionProvider` when the app shell mounts. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getStoredCsrfToken(): string | null {
  return csrfToken;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? (init.json !== undefined ? 'POST' : 'GET')).toUpperCase();

  const headers = new Headers(init.headers);
  if (init.json !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (UNSAFE.has(method) && csrfToken) headers.set(CSRF_HEADER, csrfToken);

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) throw toClientError(response, payload);
  return payload as T;
}

function toClientError(response: Response, payload: unknown): ApiClientError {
  const envelope =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error: Record<string, unknown> }).error
      : null;

  const retryAfter = response.headers.get('Retry-After');

  return new ApiClientError({
    code: typeof envelope?.code === 'string' ? envelope.code : `http_${response.status}`,
    title: typeof envelope?.title === 'string' ? envelope.title : defaultTitle(response.status),
    message:
      typeof envelope?.message === 'string'
        ? envelope.message
        : 'The request failed. Please try again.',
    status: response.status,
    details: envelope?.details,
    retryAfterSeconds: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
  });
}

function defaultTitle(status: number): string {
  if (status === 401) return 'Signed out';
  if (status === 402) return 'Payment required';
  if (status === 403) return 'Not allowed';
  if (status === 404) return 'Not found';
  if (status === 409) return 'Conflict';
  if (status === 429) return 'Too many requests';
  if (status >= 500) return 'Something went wrong';
  return 'Request failed';
}

/* ------------------------------------------------------------------ *
 *  Server-Sent Events
 * ------------------------------------------------------------------ */

export type StreamOptions = {
  json?: unknown;
  method?: string;
  signal?: AbortSignal;
};

/**
 * POSTs and consumes an SSE response.
 *
 * `EventSource` cannot send a body or custom headers, so Karo streams over a
 * normal `fetch` and parses the frames here. Malformed frames are skipped
 * rather than killing the stream — one bad chunk should not lose a whole reply.
 */
export async function apiStream<T = AgentStreamEvent>(
  path: string,
  options: StreamOptions,
  onEvent: (event: T) => void,
): Promise<void> {
  const method = (options.method ?? 'POST').toUpperCase();
  const headers = new Headers({ Accept: 'text/event-stream' });
  if (options.json !== undefined) headers.set('Content-Type', 'application/json');
  if (UNSAFE.has(method) && csrfToken) headers.set(CSRF_HEADER, csrfToken);

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    throw toClientError(response, payload);
  }
  if (!response.body) throw new Error('The server returned an empty stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');

        if (!data || data === '[DONE]') continue;
        try {
          onEvent(JSON.parse(data) as T);
        } catch {
          // Skip an unparseable frame; the stream itself is still fine.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Friendly message for a caught unknown, ready to put in a toast. */
export function describeError(error: unknown): { title: string; message: string } {
  if (error instanceof ApiClientError) return { title: error.title, message: error.message };
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { title: 'Cancelled', message: 'The request was cancelled.' };
  }
  if (!navigator.onLine) {
    return {
      title: "You're offline",
      message: 'Karo will reconnect automatically when your connection returns.',
    };
  }
  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : 'Please try again.',
  };
}
