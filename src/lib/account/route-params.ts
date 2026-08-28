import { NotFoundError } from '@/lib/api/errors';
import type { RouteParams } from '@/lib/api/handler';

/**
 * `defineHandler` hands route params through as `string | string[] | undefined`
 * because a catch-all segment can legitimately be an array. Every route in this
 * slice takes exactly one id, so this collapses the union once instead of at
 * twelve call sites — and treats a missing segment as 404 rather than letting
 * `undefined` reach a query.
 */
export function pathParam(params: RouteParams, key: string): string {
  const value = params[key];
  const resolved = Array.isArray(value) ? value[0] : value;
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new NotFoundError('Not found.');
  }
  return resolved;
}
