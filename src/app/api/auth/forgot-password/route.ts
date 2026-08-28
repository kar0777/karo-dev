import { forgotPasswordSchema } from '@/components/auth/schemas';
import { RateLimitError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requestPasswordReset } from '@/lib/auth/service';
import { rateLimitPolicy } from '@/lib/rate-limit';

/**
 * POST /api/auth/forgot-password — request a reset link.
 *
 * The response is `{ ok: true }` for every well-formed address, registered or
 * not. `requestPasswordReset` never throws and never signals which branch it
 * took, so status, body and timing are identical either way — this form cannot
 * be used to find out who has an account here.
 *
 * A 429 is the one visible difference, and it leaks nothing: the limit is keyed
 * on the submitted address whether or not it exists.
 */
export const POST = defineHandler(
  {
    auth: 'none',
    rateLimit: 'auth.reset',
    body: forgotPasswordSchema,
    audit: { action: AUDIT_ACTIONS.authPasswordResetRequested, resourceType: 'user' },
  },
  async ({ body, ip, setAudit }) => {
    const perAddress = await rateLimitPolicy('auth.reset', `${ip}:${body.email}`);
    if (!perAddress.allowed) {
      throw new RateLimitError(
        perAddress.retryAfterSeconds,
        'Too many reset requests for this email address.',
      );
    }

    await requestPasswordReset(body.email);

    setAudit({
      severity: 'notice',
      summary: `Password reset requested for ${body.email}`,
      metadata: { email: body.email },
    });

    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  },
);
