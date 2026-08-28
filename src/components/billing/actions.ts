'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { toast } from '@/components/ui/toast';
import { ApiClientError, apiFetch, describeError } from '@/lib/client/api';

/**
 * One place that knows how a billing mutation behaves: exactly one in flight at
 * a time, errors always surfaced as a toast with the API's own copy, and a
 * refresh afterwards so the server-rendered numbers are the ones on screen.
 */

export type BillingRedirect = { url: string; simulated?: boolean };

export type BillingMutationOptions<T> = {
  /** Toast shown when the request succeeds and no redirect follows. */
  success?: (result: T) => { title: string; description?: string } | null;
  /** Return a URL to hand the browser off to a checkout page. */
  redirect?: (result: T) => string | null;
};

export function useBillingMutation() {
  const router = useRouter();
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);

  const run = React.useCallback(
    async function run<T>(
      key: string,
      request: () => Promise<T>,
      options: BillingMutationOptions<T> = {},
    ): Promise<T | null> {
      setPendingKey(key);
      try {
        const result = await request();

        const url = options.redirect?.(result) ?? null;
        if (url) {
          // Deliberately do not clear `pendingKey` — the button should stay
          // busy until the navigation actually replaces the page.
          window.location.assign(url);
          return result;
        }

        const success = options.success?.(result) ?? null;
        if (success) toast.success(success.title, { description: success.description });

        setPendingKey(null);
        router.refresh();
        return result;
      } catch (error) {
        const described =
          error instanceof ApiClientError
            ? { title: error.title, message: error.message }
            : describeError(error);
        toast.error(described.title, { description: described.message });
        setPendingKey(null);
        return null;
      }
    },
    [router],
  );

  return { pendingKey, run, isPending: pendingKey !== null };
}

export async function postJson<T>(path: string, json: unknown, method = 'POST'): Promise<T> {
  return apiFetch<T>(path, { method, json });
}
