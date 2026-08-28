import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/api/errors';
import { passwordResetEmail, sendEmail, verificationEmail } from '@/lib/auth/email';
import { destroyAllSessions } from '@/lib/auth/session';
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  scorePassword,
  verifyPassword,
} from '@/lib/crypto/password';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import {
  emailTokens,
  paygBalances,
  plans,
  subscriptions,
  teamMembers,
  teams,
  users,
  type Team,
  type User,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ID_PREFIX, newId, newShortCode, newToken, type IdPrefix } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { slugify } from '@/lib/utils';

/**
 * Authentication business logic. Database-touching, HTTP-free: nothing in here
 * knows about requests, cookies or status codes, so the same functions back the
 * API routes, the seed script and the tests.
 */

const log = createLogger('auth:service');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Burned when an email does not exist, so a missing account costs the same
 * ~100 ms of scrypt as a wrong password. Computed once, lazily.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`karo-nonexistent-account-${newToken(8)}`);
  return dummyHashPromise;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function displayNameFor(email: string, name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = email.split('@')[0] ?? 'you';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function addMonths(from: Date, months: number): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() + months);
  return out;
}

/** Rejects weak passwords with the same issue list the client meter shows. */
function assertPasswordAcceptable(password: string): void {
  const issues: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 256) {
    issues.push('Use at most 256 characters');
  }

  const strength = scorePassword(password);
  if (strength.score < 2) issues.push(...strength.issues);

  if (issues.length > 0) {
    throw new ValidationError(
      'That password is not strong enough.',
      Array.from(new Set(issues)).map((message) => ({
        path: 'password',
        message,
        code: 'weak_password',
      })),
      {
        title: 'Choose a stronger password',
        description:
          'Karo requires a password that resists offline cracking. Fix the points listed and try again.',
      },
    );
  }
}

async function findUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normaliseEmail(email)}`)
    .limit(1);
  return rows[0];
}

/* ------------------------------------------------------------------ *
 *  Team provisioning
 * ------------------------------------------------------------------ */

async function uniqueTeamSlug(tx: Transaction, base: string): Promise<string> {
  const stem = slugify(base).slice(0, 32) || 'workspace';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt === 0 ? stem : `${stem}-${newShortCode(4).toLowerCase()}`;
    const existing = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  return `${stem}-${newShortCode(8).toLowerCase()}`;
}

type ProvisionOptions = {
  creditLimitMicroUsd: number;
};

/**
 * Creates the personal team plus everything billing needs to exist for it:
 * an owner membership, a PAYG balance row and a subscription on the free tier.
 * Doing this at signup means quota, overage and settlement code only ever has
 * to handle one shape — there is no "user without a team" branch anywhere.
 */
async function provisionPersonalTeam(
  tx: Transaction,
  user: Pick<User, 'id' | 'email' | 'name'>,
  options: ProvisionOptions,
): Promise<Team> {
  const name = displayNameFor(user.email, user.name);
  const slug = await uniqueTeamSlug(tx, name);
  const teamId = newId(ID_PREFIX.team);
  const now = new Date();

  const inserted = await tx
    .insert(teams)
    .values({
      id: teamId,
      name,
      slug,
      ownerId: user.id,
      isPersonal: true,
    })
    .returning();

  const team = inserted[0];
  if (!team) throw new Error('Team insert returned no row');

  await tx.insert(teamMembers).values({
    id: newId(ID_PREFIX.teamMember),
    teamId,
    userId: user.id,
    role: 'owner',
  });

  await tx.insert(paygBalances).values({
    id: newId(ID_PREFIX.paygBalance),
    teamId,
    balanceMicroUsd: 0,
    creditLimitMicroUsd: options.creditLimitMicroUsd,
  });

  // The entry plan is whatever the catalogue calls `payg`. Before the seed has
  // run there is no plan at all, and that is fine: the team simply has no
  // subscription row until one is chosen.
  const planRows = await tx
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.tier, 'payg'), eq(plans.isActive, true)))
    .orderBy(asc(plans.sortOrder))
    .limit(1);

  const plan = planRows[0];
  if (plan) {
    await tx.insert(subscriptions).values({
      id: newId(ID_PREFIX.subscription),
      teamId,
      planId: plan.id,
      status: 'active',
      interval: 'month',
      currentPeriodStart: now,
      currentPeriodEnd: addMonths(now, 1),
    });
  } else {
    log.warn('No PAYG plan found — team created without a subscription', { teamId });
  }

  return team;
}

/** Backfills a personal team for an account that somehow has none. */
export async function ensurePersonalTeam(user: User): Promise<Team> {
  const existing = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, user.id), eq(teams.isPersonal, true)))
    .orderBy(asc(teams.createdAt))
    .limit(1);

  const found = existing[0]?.team;
  if (found) return found;

  const creditLimitMicroUsd = await getSetting(
    SETTING_KEYS.billingPaygCreditLimitMicroUsd,
    settingDefault(SETTING_KEYS.billingPaygCreditLimitMicroUsd),
  );

  return db.transaction(async (tx) => {
    const team = await provisionPersonalTeam(tx, user, { creditLimitMicroUsd });
    if (!user.defaultTeamId) {
      await tx.update(users).set({ defaultTeamId: team.id }).where(eq(users.id, user.id));
    }
    return team;
  });
}

/* ------------------------------------------------------------------ *
 *  Email tokens
 * ------------------------------------------------------------------ */

type EmailTokenKind = 'verify_email' | 'reset_password';

/**
 * `ids.ts` predates this table and has no entry for it. Keeping the prefix
 * self-describing matters more than the registry being exhaustive.
 */
const EMAIL_TOKEN_PREFIX = 'emt' as IdPrefix;

async function issueEmailToken(
  userId: string,
  kind: EmailTokenKind,
  ttlMs: number,
): Promise<string> {
  const token = newToken(32);

  // One live token per purpose: issuing a new link invalidates the old one.
  await db
    .update(emailTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.kind, kind),
        isNull(emailTokens.consumedAt),
      ),
    );

  await db.insert(emailTokens).values({
    id: newId(EMAIL_TOKEN_PREFIX),
    userId,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return token;
}

/** Consumes a token atomically; a replayed link finds nothing to consume. */
async function consumeEmailToken(
  token: string,
  kind: EmailTokenKind,
): Promise<{ userId: string }> {
  const consumed = await db
    .update(emailTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.kind, kind),
        isNull(emailTokens.consumedAt),
        sql`${emailTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: emailTokens.userId });

  const row = consumed[0];
  if (!row) {
    throw new ValidationError(
      'This link is no longer valid.',
      [{ path: 'token', message: 'Expired or already used', code: 'invalid_token' }],
      {
        title: 'This link has expired',
        description:
          'Verification and reset links can be used once and expire quickly. Request a new one to continue.',
      },
    );
  }
  return row;
}

function actionUrl(path: string, token: string): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

/** Issues a verification token and mails the link. Safe to call repeatedly. */
export async function sendVerificationEmail(user: User): Promise<void> {
  const token = await issueEmailToken(user.id, 'verify_email', VERIFICATION_TTL_MS);
  const url = actionUrl('/verify-email', token);
  await sendEmail({ to: user.email, ...verificationEmail(user, url) });
}

/* ------------------------------------------------------------------ *
 *  Registration & sign-in
 * ------------------------------------------------------------------ */

export type RegisterInput = {
  email: string;
  password: string;
  name?: string | null;
};

/** True when public sign-up is switched on in admin settings. */
export async function isSignupEnabled(): Promise<boolean> {
  return getSetting(
    SETTING_KEYS.authSignupEnabled,
    settingDefault(SETTING_KEYS.authSignupEnabled),
  );
}

/**
 * Creates a user, their personal team, an owner membership, a PAYG balance and
 * an entry subscription — then issues a verification link.
 *
 * The `ConflictError` message is deliberately generic. The registration route
 * decides whether to surface "already registered" (fine when the caller proved
 * ownership of the address) or to answer with the same success shape as a new
 * signup; this layer never makes that call for it.
 */
export async function registerUser(input: RegisterInput): Promise<User> {
  const email = normaliseEmail(input.email);

  if (!email || !email.includes('@')) {
    throw new ValidationError('Enter a valid email address.', [
      { path: 'email', message: 'Enter a valid email address', code: 'invalid_email' },
    ]);
  }

  assertPasswordAcceptable(input.password);

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new ConflictError('That email address cannot be registered.', {
      title: 'Try signing in instead',
      description:
        'This address cannot be used to create a new account. If it is yours, sign in or reset your password.',
    });
  }

  const passwordHash = await hashPassword(input.password);
  const creditLimitMicroUsd = await getSetting(
    SETTING_KEYS.billingPaygCreditLimitMicroUsd,
    settingDefault(SETTING_KEYS.billingPaygCreditLimitMicroUsd),
  );

  const user = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        id: newId(ID_PREFIX.user),
        email,
        name: displayNameFor(email, input.name),
        passwordHash,
        platformRole: 'user',
      })
      .returning();

    const created = inserted[0];
    if (!created) throw new Error('User insert returned no row');

    const team = await provisionPersonalTeam(tx, created, { creditLimitMicroUsd });

    const updated = await tx
      .update(users)
      .set({ defaultTeamId: team.id, updatedAt: new Date() })
      .where(eq(users.id, created.id))
      .returning();

    return updated[0] ?? { ...created, defaultTeamId: team.id };
  });

  // Never let a mail failure roll back a completed signup — the user can ask
  // for a new link from the verification screen.
  try {
    await sendVerificationEmail(user);
  } catch (error) {
    log.error('Could not send the verification email', { userId: user.id, error });
  }

  log.info('Registered a new account', { userId: user.id });
  return user;
}

/**
 * Creates (or returns) the account behind an OAuth sign-in.
 *
 * OAuth providers have already verified the address, so the user lands
 * email-verified and without a password — signing in with a password stays
 * available later only through "forgot password", which sets one. Provisioning
 * mirrors `registerUser` exactly: a user never exists without their personal
 * team, membership, PAYG balance and entry subscription.
 */
export async function registerOAuthUser(input: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<{ user: User; created: boolean }> {
  const email = normaliseEmail(input.email);
  if (!email || !email.includes('@')) {
    throw new ValidationError('The identity provider did not return a usable email address.');
  }

  const existing = await findUserByEmail(email);
  if (existing) return { user: existing, created: false };

  const creditLimitMicroUsd = await getSetting(
    SETTING_KEYS.billingPaygCreditLimitMicroUsd,
    settingDefault(SETTING_KEYS.billingPaygCreditLimitMicroUsd),
  );

  const user = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        id: newId(ID_PREFIX.user),
        email,
        name: displayNameFor(email, input.name),
        avatarUrl: input.avatarUrl ?? null,
        emailVerifiedAt: new Date(),
        platformRole: 'user',
      })
      .returning();

    const created = inserted[0];
    if (!created) throw new Error('User insert returned no row');

    const team = await provisionPersonalTeam(tx, created, { creditLimitMicroUsd });

    const updated = await tx
      .update(users)
      .set({ defaultTeamId: team.id, updatedAt: new Date() })
      .where(eq(users.id, created.id))
      .returning();

    return updated[0] ?? { ...created, defaultTeamId: team.id };
  });

  log.info('Registered a new account via OAuth', { userId: user.id });
  return { user, created: true };
}

export type AuthenticateInput = {
  email: string;
  password: string;
};

/**
 * Verifies credentials in roughly constant time: a missing account still runs a
 * full scrypt verification against a throwaway hash, so response latency does
 * not reveal which addresses are registered.
 */
export async function authenticate(input: AuthenticateInput): Promise<User> {
  const email = normaliseEmail(input.email);
  const user = await findUserByEmail(email);

  const stored = user?.passwordHash ?? (await dummyHash());
  const passwordOk = await verifyPassword(input.password, stored);

  if (!user || !user.passwordHash || !passwordOk) {
    throw new UnauthorizedError('That email and password combination is not correct.');
  }

  if (user.isSuspended) {
    throw new ForbiddenError('This account is suspended.', {
      title: 'Account suspended',
      description:
        'A platform administrator suspended this account. Contact support to have it restored — your projects and data are untouched.',
    });
  }

  await db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, user.id))
    .catch((error: unknown) => {
      log.warn('Could not stamp lastSeenAt', { userId: user.id, error });
    });

  return user;
}

/* ------------------------------------------------------------------ *
 *  Email verification & password reset
 * ------------------------------------------------------------------ */

export async function verifyEmail(token: string): Promise<User> {
  const { userId } = await consumeEmailToken(token, 'verify_email');

  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  const user = updated[0];
  if (!user) throw new NotFoundError('Account not found.');

  log.info('Email verified', { userId });
  return user;
}

/**
 * Always resolves, whether or not the address exists — the route answers
 * identically either way so the form cannot be used to enumerate accounts.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);

  if (!user) {
    log.debug('Password reset requested for an unknown address');
    return;
  }
  if (user.isSuspended) {
    log.warn('Password reset requested for a suspended account', { userId: user.id });
    return;
  }

  const token = await issueEmailToken(user.id, 'reset_password', RESET_TTL_MS);
  const url = actionUrl('/reset-password', token);

  try {
    await sendEmail({ to: user.email, ...passwordResetEmail(user, url) });
  } catch (error) {
    log.error('Could not send the password reset email', { userId: user.id, error });
  }
}

/**
 * Sets a new password and signs every device out. Clicking a link delivered to
 * the address also proves ownership of it, so an unverified account becomes
 * verified here.
 */
export async function resetPassword(token: string, newPassword: string): Promise<User> {
  assertPasswordAcceptable(newPassword);

  const { userId } = await consumeEmailToken(token, 'reset_password');
  const passwordHash = await hashPassword(newPassword);

  const updated = await db
    .update(users)
    .set({
      passwordHash,
      emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  const user = updated[0];
  if (!user) throw new NotFoundError('Account not found.');

  const revoked = await destroyAllSessions(userId);
  log.info('Password reset completed', { userId, revokedSessions: revoked });

  return user;
}

/** Changes a password for an already-signed-in user. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  assertPasswordAcceptable(newPassword);

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new NotFoundError('Account not found.');

  const ok = user.passwordHash
    ? await verifyPassword(currentPassword, user.passwordHash)
    : false;
  if (!ok) {
    throw new UnauthorizedError('Your current password is not correct.');
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/* ------------------------------------------------------------------ *
 *  Demo access
 * ------------------------------------------------------------------ */

/**
 * One-click sign-in to the seeded demo account. Gated by the environment
 * *and* by an admin setting, so a public deployment can turn it off without a
 * redeploy.
 */
export async function loginDemoUser(): Promise<User> {
  if (!env.KARO_ALLOW_DEMO_LOGIN) {
    throw new ForbiddenError('Demo sign-in is disabled on this deployment.', {
      title: 'Demo sign-in is off',
      description: 'This installation does not allow signing in to the shared demo account.',
    });
  }

  const enabled = await getSetting(
    SETTING_KEYS.authDemoLoginEnabled,
    settingDefault(SETTING_KEYS.authDemoLoginEnabled),
  );
  if (!enabled) {
    throw new ForbiddenError('Demo sign-in is disabled on this deployment.', {
      title: 'Demo sign-in is off',
      description: 'An administrator turned off the shared demo account for this installation.',
    });
  }

  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.isDemo, true), eq(users.isSuspended, false)))
    .orderBy(asc(users.createdAt))
    .limit(1);

  const user = rows[0];
  if (!user) {
    throw new NotFoundError('The demo account has not been created yet.', {
      title: 'Demo account missing',
      description:
        'This database has not been seeded. Run `npm run db:seed` to create the demo workspace, then try again.',
    });
  }

  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));

  return user;
}
