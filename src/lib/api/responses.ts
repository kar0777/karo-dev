import { env } from '@/lib/env';

import { ApiError, toApiError } from './errors';

/**
 * Response builders. Every JSON body the API produces goes through here, which
 * is what makes the error envelope uniform enough for the client to render an
 * `ErrorState` without knowing which route it came from.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

function withHeaders(init: ResponseInit | undefined, extra: HeadersInit): Headers {
  const headers = new Headers(init?.headers);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    status: init?.status ?? 200,
    headers: withHeaders(init, JSON_HEADERS),
  });
}

export function created<T>(data: T, init?: ResponseInit): Response {
  return json(data, { ...init, status: 201 });
}

export function noContent(init?: ResponseInit): Response {
  return new Response(null, { ...init, status: 204, headers: withHeaders(init, {}) });
}

/** `{ ok: true }` — for mutations with nothing meaningful to return. */
export function accepted<T>(data: T, init?: ResponseInit): Response {
  return json(data, { ...init, status: 202 });
}

export type ErrorEnvelope = {
  error: {
    code: string;
    title: string;
    message: string;
    details?: unknown;
    retryAfterSeconds?: number;
  };
};

/**
 * Serialises any thrown value into the standard envelope.
 * Stack traces and raw 5xx messages never cross the wire in production.
 */
export function errorResponse(error: unknown, init?: ResponseInit): Response {
  const apiError: ApiError = toApiError(error);
  const includeInternalMessage = env.NODE_ENV !== 'production';

  const envelope: ErrorEnvelope = { error: apiError.toBody(includeInternalMessage) };

  const headers = withHeaders(init, {
    ...JSON_HEADERS,
    'x-karo-error-code': apiError.code,
    'cache-control': 'no-store',
  });
  if (apiError.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(Math.max(1, Math.ceil(apiError.retryAfterSeconds))));
  }

  return new Response(JSON.stringify(envelope), {
    ...init,
    status: apiError.status,
    headers,
  });
}

/** Server-Sent Events stream with the headers proxies need to not buffer it. */
export function eventStream(stream: ReadableStream<Uint8Array>, init?: ResponseInit): Response {
  return new Response(stream, {
    ...init,
    status: init?.status ?? 200,
    headers: withHeaders(init, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    }),
  });
}
