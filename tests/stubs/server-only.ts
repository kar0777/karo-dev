/**
 * Stub for the `server-only` package.
 *
 * In the app, importing `server-only` from a Client Component is a build error
 * — that is its whole job. Vitest runs on the server, so the guard has nothing
 * to protect and would simply block integration tests from importing modules
 * like `@/lib/db`. Aliased in `vitest.config.ts`.
 */
export {};
