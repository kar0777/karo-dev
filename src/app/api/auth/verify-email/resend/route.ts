import { RateLimitError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { sendVerificationEmail } from '@/lib/auth/service';
import { rateLimitPolicy } from '@/lib/rate-limit';

/**
 * POST /api/auth/verify-email/resend — issue a fresh confirmation link.
 *
 * Not in the original route contract; the verification screen needs it, because
 * a 24-hour single-use link expiring is the normal case, not an edge one.
 *
 * Sign-in is required: without a session there is no way to know which address
 * to send to, and accepting one in the body would turn this into an open mail
 * relay pointed at arbitrary strangers.
 *
 * Issuing a token invalidates the previous one (see `issueEmailToken`), so an
 * impatient double-click cannot leave two live links in an inbox.
 */
export const POST = defineHandler(
  { auth: 'required', rateLimit: 'auth.reset' },
  async ({ user }) => {
    const perUser = await rateLimitPolicy('auth.reset', `user:${user.id}`);
    if (!perUser.allowed) {
      throw new RateLimitError(
        perUser.retryAfterSeconds,
        'Too many confirmation emails requested for this account.',
      );
    }

    if (user.emailVerifiedAt) {
      return json(
        { ok: true, alreadyVerified: true },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    await sendVerificationEmail(user);

    return json(
      { ok: true, alreadyVerified: false },
      { headers: { 'cache-control': 'no-store' } },
    );
  },
);
