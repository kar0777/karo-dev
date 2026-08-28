'use client';

import { useEffect } from 'react';

import { setCsrfToken } from '@/lib/client/api';

/**
 * Drops any CSRF token left over from a previous session.
 *
 * `setCsrfToken` parks the token in module state, which survives a client-side
 * navigation — so a tab that signs out and lands on `/login` is still holding
 * the token of the session it just destroyed. Sending that token fails the
 * double-submit check outright, because `assertCsrf` compares it against a
 * session that no longer exists. Sending *nothing* falls through to the
 * same-origin proof, which is exactly the path a signed-out request is meant to
 * take.
 *
 * Only the signed-out flows use this. The verification screen deliberately does
 * not: its resend endpoint needs a session, and therefore a live token.
 */
export function useSignedOutCsrf(): void {
  useEffect(() => {
    setCsrfToken(null);
  }, []);
}
