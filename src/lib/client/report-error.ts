/**
 * Sends a browser crash to the server.
 *
 * Deliberately not built on `apiFetch`. That helper throws `ApiClientError` on a
 * non-2xx, and the caller here is an error boundary — a reporter that can throw
 * turns a handled crash into an unhandled one, inside the component whose whole
 * job is to be the last line of defence. So this uses `fetch` directly, swallows
 * everything, and depends on nothing but the platform.
 *
 * `keepalive` matters: a user's first instinct on a broken page is to reload or
 * close the tab, and a normal `fetch` is cancelled when the document goes away.
 */

const ENDPOINT = '/api/observability/client-error';

export type ClientErrorReport = {
  error: unknown;
  /** Which boundary caught it — `app`, `admin`, `billing`, `global`, … */
  boundary: string;
};

/** Caps mirror the server's zod schema, so nothing is rejected for length. */
const LIMITS = { message: 2_000, name: 200, stack: 10_000, path: 500 } as const;

function clamp(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length <= max ? value : value.slice(0, max);
}

export function reportClientError({ error, boundary }: ClientErrorReport): void {
  // Never let reporting interfere with rendering the fallback UI.
  try {
    const asError = error instanceof Error ? error : undefined;
    const digest = (error as { digest?: unknown } | null)?.digest;

    const payload = {
      message: clamp(asError?.message || String(error), LIMITS.message) ?? 'Unknown error',
      name: clamp(asError?.name, LIMITS.name),
      stack: clamp(asError?.stack, LIMITS.stack),
      digest: typeof digest === 'string' ? digest.slice(0, 200) : undefined,
      path: clamp(
        typeof window === 'undefined' ? undefined : window.location.pathname,
        LIMITS.path,
      ),
      boundary,
    };

    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      cache: 'no-store',
      // Survives the reload or tab close that usually follows a crash.
      keepalive: true,
    }).catch(() => {
      // The server is unreachable or returned an error. There is nothing
      // useful to do about it from inside a crashed page.
    });
  } catch {
    // Serialising the error failed, which means it was something exotic.
    // Dropping the report is strictly better than crashing the boundary.
  }
}
