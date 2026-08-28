import 'server-only';

import { createHash } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { ApiError, ConflictError, InternalError } from '@/lib/api/errors';
import { BillingError } from '@/lib/billing';
import { env } from '@/lib/env';

/**
 * Helpers shared by the billing route handlers. Not a route itself — the
 * underscore prefix keeps it out of the App Router's file conventions.
 */

/**
 * Deterministic idempotency key.
 *
 * Two goals: a double-clicked button must not buy the same thing twice, and a
 * retried request from the same client must reach the provider with the same
 * key. Bucketing by minute is what makes it deterministic without also
 * permanently blocking a genuine second purchase of the same amount.
 */
export function billingIdempotencyKey(
  scope: string,
  parts: ReadonlyArray<string | number>,
  bucketSeconds = 60,
): string {
  const bucket = Math.floor(Date.now() / (bucketSeconds * 1000));
  const digest = createHash('sha256')
    .update([scope, ...parts.map(String), bucket].join('|'))
    .digest('base64url')
    .slice(0, 32);
  return `${scope}_${digest}`;
}

/** Absolute URL on whichever origin actually served this request. */
export function absoluteUrl(req: NextRequest, path: string): string {
  const origin = req.nextUrl.origin || env.APP_URL;
  return new URL(path, origin).toString();
}

const UNIQUE_VIOLATION = '23505';

/**
 * Maps a provider failure onto the API error taxonomy. `BillingError` already
 * carries a status and a human message; everything else is a bug on our side
 * and must not leak its text to the client.
 */
export function toBillingApiError(error: unknown): Error {
  if (error instanceof BillingError) {
    switch (error.status) {
      case 402:
        return new ApiError({
          status: 402,
          code: 'payment_required',
          message: error.message,
          title: 'Payment required',
          description: error.message,
        });
      case 403:
        return new ApiError({
          status: 403,
          code: 'forbidden',
          message: error.message,
          title: 'Not allowed',
          description: error.message,
        });
      case 404:
        return new ApiError({
          status: 404,
          code: 'not_found',
          message: error.message,
          title: 'Not found',
          description: error.message,
        });
      case 409:
        return new ConflictError(error.message, {
          title: 'Already in progress',
          description:
            'An identical request was just submitted. Wait a moment and refresh the billing page before trying again.',
        });
      case 502:
      case 503:
        return new ApiError({
          status: 503,
          code: 'provider_unavailable',
          message: error.message,
          title: 'Billing provider unavailable',
          description: `${error.message} Nothing was charged — try again in a moment.`,
          expose: true,
        });
      default:
        return new ApiError({
          status: 400,
          code: 'validation_error',
          message: error.message,
          title: 'Billing could not complete that',
          description: error.message,
        });
    }
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  ) {
    return new ConflictError('That purchase was already submitted.', {
      title: 'Duplicate request',
      description:
        'An identical purchase is already recorded. Refresh the billing page to see it — nothing was charged twice.',
    });
  }

  return new InternalError(
    error instanceof Error ? error.message : 'Billing provider failure',
    error,
  );
}
