import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  AVATAR_COLORS,
  mergePreferences,
  readPreferences,
  type ThemePreference,
} from '@/lib/account/preferences';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { sendVerificationEmail } from '@/lib/auth/service';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import type { Locale } from '@/lib/i18n';
import { createLogger } from '@/lib/logger';

/**
 * Profile settings.
 *
 * Changing the email address drops the verified flag and re-issues a
 * verification link: an address nobody has proved they own must not keep the
 * trust the previous one earned.
 */

const log = createLogger('api:settings:profile');

/** Spelled out rather than derived so Zod keeps the literal union types. */
const localeSchema = z.enum(['en', 'ru'] satisfies readonly Locale[] as ['en', 'ru']);
const themeSchema = z.enum(['system', 'light', 'dark'] satisfies readonly ThemePreference[] as [
  'system',
  'light',
  'dark',
]);

const bodySchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(80).optional(),
    email: z.email('Enter a valid email address').max(254).optional(),
    avatarColor: z.enum(AVATAR_COLORS).optional(),
    locale: localeSchema.optional(),
    theme: themeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: 'user.profile_update', resourceType: 'user' },
  },
  async ({ user, body, setAudit }) => {
    const nextEmail = body.email ? body.email.trim().toLowerCase() : undefined;
    const emailChanged = Boolean(nextEmail && nextEmail !== user.email.toLowerCase());

    if (emailChanged && nextEmail) {
      const taken = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${nextEmail}`)
        .limit(1);

      if (taken.length > 0 && taken[0]?.id !== user.id) {
        throw new ConflictError('That email address is already in use.', {
          title: 'Email already registered',
          description:
            'Another Karo account already uses this address. Sign in to that account, or pick a different address.',
        });
      }
    }

    const onboardingState = body.avatarColor
      ? mergePreferences(user.onboardingState, { avatarColor: body.avatarColor })
      : undefined;

    const updated = await db
      .update(users)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(emailChanged && nextEmail ? { email: nextEmail, emailVerifiedAt: null } : {}),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.theme === undefined ? {} : { theme: body.theme }),
        ...(onboardingState ? { onboardingState } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    const row = updated[0];
    if (!row) throw new NotFoundError('Account not found.');

    if (emailChanged) {
      // A dead mail transport must not roll back a saved profile — the user can
      // request a fresh link from the verification screen.
      try {
        await sendVerificationEmail(row);
      } catch (error) {
        log.error('Could not send the re-verification email', { userId: row.id, error });
      }
    }

    setAudit({
      resourceId: row.id,
      summary: emailChanged ? 'Profile and email address updated' : 'Profile updated',
      severity: emailChanged ? 'notice' : 'info',
      metadata: {
        fields: Object.keys(body),
        emailChanged,
      },
    });

    const preferences = readPreferences(row.onboardingState);

    return json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: Boolean(row.emailVerifiedAt),
        locale: row.locale,
        theme: row.theme,
        avatarColor: preferences.avatarColor,
      },
      emailChanged,
    });
  },
);
