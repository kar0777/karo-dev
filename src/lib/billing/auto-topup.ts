import 'server-only';

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { notifications, paygBalances, teams, users, type Team } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { formatMicroUsd } from '@/lib/utils';
import { creditTopup } from './credit';
import { getBillingProvider } from './index';
import type { BillingProvider, OffSessionFailure } from './types';

const log = createLogger('billing:auto-topup');

/**
 * Automatic pay-as-you-go top-up.
 *
 * The hard part is not the charge, it is refusing to make it twice. Two agent
 * runs settling in the same second both read the same low balance, a sweep and a
 * settlement can overlap, and a team whose balance stays below the threshold
 * even after a successful charge would otherwise be milked in a loop. So every
 * attempt has to win a claim in the database first, and a card that keeps
 * failing has to be given up on rather than retried forever.
 */

/**
 * Minimum gap between two attempts for one team.
 *
 * Fifteen minutes is short enough that a team that genuinely burns through a
 * top-up mid-run is refilled while they are still working, and long enough that
 * every settlement of a single run collapses into one charge. It is also the
 * only bound on the pathological case the threshold check cannot catch — a
 * balance so far negative that even a fresh top-up leaves it below the
 * threshold. At the minimum top-up that is four charges an hour, not four
 * hundred.
 */
const MIN_ATTEMPT_INTERVAL_MS = 15 * 60_000;

/**
 * Consecutive refusals tolerated before automatic top-up pauses itself.
 *
 * Stripe already retries the network layer, so three distinct refusals mean the
 * card itself is the problem and hammering it only feeds the issuer's fraud
 * heuristics. The counter is cleared the moment the balance is healthy again
 * (see `attemptAutoTopup`), so a team is never locked out permanently.
 *
 * Only the failures in `DEFINITIVE_FAILURES` count towards it — see there.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Failures that prove the money did not move.
 *
 * A refusal is an answer: the bank said no, the bank wants the cardholder, or
 * there is no card at all. Nothing was taken, so the next attempt has to be a
 * genuinely new payment, and three of them in a row are what the pause exists
 * for. `provider_error` is the opposite — a dropped connection or a 5xx leaves
 * it unknown whether Stripe took the money, and the only safe move is to repeat
 * the *same* payment until Stripe says. Counting those towards the pause would
 * both hide an outage behind a card-shaped message and, because the count is
 * half of `chargeKey`, turn every repeat into a second charge.
 */
const DEFINITIVE_FAILURES: ReadonlySet<OffSessionFailure> = new Set([
  'no_payment_method',
  'requires_action',
  'card_declined',
]);

export type AutoTopupSkipReason =
  | 'unknown_team'
  | 'disabled'
  | 'not_configured'
  | 'no_balance'
  | 'above_threshold'
  | 'recently_attempted'
  | 'paused_after_failures';

export type AutoTopupOutcome =
  | { status: 'skipped'; reason: AutoTopupSkipReason }
  | { status: 'charged'; amountMicroUsd: number; paymentId: string }
  | { status: 'failed'; failure: OffSessionFailure; message: string; gaveUp: boolean };

/**
 * Tops a team's balance up when it has fallen to their threshold.
 *
 * Safe to call on every settlement: the ordinary cases — switched off, still in
 * credit — cost one indexed read and no writes, and nothing here throws into the
 * caller. Metering must never lose a usage record because a card was declined.
 */
export async function maybeAutoTopup(teamId: string): Promise<AutoTopupOutcome> {
  try {
    return await attemptAutoTopup(teamId);
  } catch (error) {
    log.error('Automatic top-up failed unexpectedly', { teamId, error });
    return {
      status: 'failed',
      failure: 'provider_error',
      message: 'The automatic top-up could not be completed.',
      gaveUp: false,
    };
  }
}

export type AutoTopupSweepResult = {
  considered: number;
  charged: string[];
  failed: string[];
};

/**
 * Sweeps every team with automatic top-up switched on.
 *
 * The scheduler that calls this is the only thing that refills a balance —
 * nothing on the run path does — and that is deliberate: the team who needs it
 * most has *stopped* running agents because they ran out, so a trigger hung off
 * metering would reach everyone except them. It is also what clears a stale
 * failure count after someone has topped up by hand.
 */
export async function sweepAutoTopups(): Promise<AutoTopupSweepResult> {
  const enabled = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.autoTopupEnabled, true))
    .limit(500);

  const result: AutoTopupSweepResult = { considered: enabled.length, charged: [], failed: [] };

  // Sequential on purpose. These are card charges: fanning them out would turn a
  // provider outage into hundreds of simultaneous retries.
  for (const row of enabled) {
    const outcome = await maybeAutoTopup(row.id);
    if (outcome.status === 'charged') result.charged.push(row.id);
    else if (outcome.status === 'failed') result.failed.push(row.id);
  }

  if (result.charged.length > 0 || result.failed.length > 0) {
    log.info('Automatic top-up sweep finished', {
      considered: result.considered,
      charged: result.charged.length,
      failed: result.failed.length,
    });
  }

  return result;
}

/* ------------------------------------------------------------------ *
 *  Internals
 * ------------------------------------------------------------------ */

async function attemptAutoTopup(teamId: string): Promise<AutoTopupOutcome> {
  const [row] = await db
    .select({ team: teams, balance: paygBalances })
    .from(teams)
    .leftJoin(paygBalances, eq(paygBalances.teamId, teams.id))
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!row) {
    log.warn('Automatic top-up was asked about a team that does not exist', { teamId });
    return { status: 'skipped', reason: 'unknown_team' };
  }

  const team = row.team;
  if (!team.autoTopupEnabled) return { status: 'skipped', reason: 'disabled' };
  if (team.autoTopupAmountMicroUsd <= 0) return { status: 'skipped', reason: 'not_configured' };
  if (!row.balance) return { status: 'skipped', reason: 'no_balance' };

  const balanceMicroUsd = row.balance.balanceMicroUsd;

  if (balanceMicroUsd > team.autoTopupThresholdMicroUsd) {
    // A healthy balance is the only proof we get that whatever was wrong with
    // the payment method has been sorted out, so it is what re-arms the budget.
    if (team.autoTopupFailureCount > 0) {
      await db
        .update(teams)
        .set({ autoTopupFailureCount: 0, autoTopupLastError: null, updatedAt: new Date() })
        .where(eq(teams.id, teamId));
    }
    return { status: 'skipped', reason: 'above_threshold' };
  }

  if (team.autoTopupFailureCount >= MAX_CONSECUTIVE_FAILURES) {
    return { status: 'skipped', reason: 'paused_after_failures' };
  }

  /*
   * Claim the attempt before charging anything.
   *
   * Postgres serialises the two updates, and the loser re-evaluates its `where`
   * against the row the winner just wrote — where the timestamp is now too
   * recent — so exactly one caller comes back with a row. The column is written
   * *before* the charge rather than after it, which makes it "last attempt"
   * rather than "last success": a failed attempt has to throttle the next one
   * just as hard, or a dead card would be retried on every settlement.
   */
  const attemptedAt = new Date();
  const claimed = await db
    .update(teams)
    .set({ autoTopupLastChargedAt: attemptedAt })
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.autoTopupEnabled, true),
        lt(teams.autoTopupFailureCount, MAX_CONSECUTIVE_FAILURES),
        or(
          isNull(teams.autoTopupLastChargedAt),
          lt(
            teams.autoTopupLastChargedAt,
            new Date(attemptedAt.getTime() - MIN_ATTEMPT_INTERVAL_MS),
          ),
        ),
      ),
    )
    .returning({ id: teams.id });

  if (claimed.length === 0) return { status: 'skipped', reason: 'recently_attempted' };

  const provider = getBillingProvider();
  const customerId = team.stripeCustomerId ?? (await customerFor(provider, team));
  if (!customerId) {
    return recordFailure(
      team,
      'no_payment_method',
      'This team has no billing account yet, so there is nothing to charge.',
    );
  }

  const amountMicroUsd = team.autoTopupAmountMicroUsd;

  const charge = await provider.chargeOffSession({
    teamId,
    customerId,
    amountMicroUsd,
    description: 'Karo automatic pay-as-you-go top-up',
    idempotencyKey: chargeKey(team, row.balance.lifetimeToppedUpMicroUsd),
  });

  if (charge.status === 'failed') {
    return recordFailure(team, charge.failure, charge.message);
  }

  let credited: boolean;
  try {
    credited = await creditTopup({
      teamId,
      amountMicroUsd,
      provider: provider.key,
      idempotencyKey: `auto-topup:${charge.paymentId}`,
      stripePaymentIntentId: charge.paymentId,
    });
  } catch (error) {
    return haltAfterUncreditedCharge(team, charge.paymentId, amountMicroUsd, error);
  }

  if (!credited) {
    // The unique index rejected the row, so this payment is already on the
    // ledger. Nothing to add, and nothing the owner needs to hear twice.
    log.warn('An automatic top-up payment had already been credited', {
      teamId,
      paymentId: charge.paymentId,
    });
    return { status: 'charged', amountMicroUsd, paymentId: charge.paymentId };
  }

  await db
    .update(teams)
    .set({ autoTopupFailureCount: 0, autoTopupLastError: null, updatedAt: new Date() })
    .where(eq(teams.id, teamId));

  const simulated = provider.key === 'mock';

  await recordAudit({
    action: AUDIT_ACTIONS.billingTopup,
    teamId,
    actorType: 'system',
    resourceType: 'team',
    resourceId: teamId,
    severity: 'notice',
    summary: `Automatic top-up added ${formatMicroUsd(amountMicroUsd)}`,
    metadata: {
      provider: provider.key,
      paymentId: charge.paymentId,
      balanceBeforeMicroUsd: balanceMicroUsd,
      thresholdMicroUsd: team.autoTopupThresholdMicroUsd,
    },
  });

  await notifyOwner(team, {
    level: 'success',
    title: 'Balance topped up automatically',
    body: `The balance had fallen to ${formatMicroUsd(balanceMicroUsd)}, so Karo added ${formatMicroUsd(amountMicroUsd)}.${
      simulated ? ` No card was charged — this deployment runs on ${provider.displayName}.` : ''
    }`,
  });

  log.info('Automatic top-up completed', {
    teamId,
    amountMicroUsd,
    provider: provider.key,
    paymentId: charge.paymentId,
  });

  return { status: 'charged', amountMicroUsd, paymentId: charge.paymentId };
}

/**
 * The provider idempotency key for one logical top-up.
 *
 * It must stay the same for exactly as long as the previous attempt's outcome is
 * unknown, and change the moment it is known — which is why neither half is a
 * clock. `lifetimeToppedUpMicroUsd` only moves when a payment has actually
 * reached the ledger (`creditTopup` moves the two together), and the failure
 * count only when the card gave a definite answer. So a charge that Stripe took
 * but never got to report — a dropped connection, a 5xx, a container that died
 * before the ledger write — is retried under the key it was made with: Stripe
 * replays the original PaymentIntent instead of charging the card again, and the
 * reply is what finally credits it. A per-attempt timestamp could do neither,
 * because the claim in `attemptAutoTopup` guarantees only one call ever holds
 * any given one.
 */
function chargeKey(team: Team, lifetimeToppedUpMicroUsd: number): string {
  return `auto-topup:${team.id}:${lifetimeToppedUpMicroUsd}:${team.autoTopupFailureCount}`;
}

/**
 * A team that has never checked out has no provider customer yet. The simulator
 * mints one for free, which is what lets demo mode walk this whole path; Stripe
 * creates a real but empty customer, and the charge that follows then reports
 * the missing card itself rather than this function guessing at it.
 */
async function customerFor(provider: BillingProvider, team: Team): Promise<string | null> {
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, team.ownerId))
    .limit(1);
  if (!owner) return null;

  return provider.ensureCustomer({
    teamId: team.id,
    teamName: team.name,
    email: owner.email,
    existingCustomerId: null,
  });
}

async function recordFailure(
  team: Team,
  failure: OffSessionFailure,
  message: string,
): Promise<AutoTopupOutcome> {
  const definitive = DEFINITIVE_FAILURES.has(failure);

  // Incremented in SQL rather than from the row we read, so the stored count is
  // right even if something else touched the team between the two.
  const [updated] = await db
    .update(teams)
    .set({
      ...(definitive ? { autoTopupFailureCount: sql`${teams.autoTopupFailureCount} + 1` } : {}),
      autoTopupLastError: message,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, team.id))
    .returning({ failureCount: teams.autoTopupFailureCount });

  const failureCount =
    updated?.failureCount ?? team.autoTopupFailureCount + (definitive ? 1 : 0);
  const gaveUp = failureCount >= MAX_CONSECUTIVE_FAILURES;

  log.warn('An automatic top-up did not go through', {
    teamId: team.id,
    failure,
    failureCount,
    gaveUp,
  });

  if (gaveUp) {
    await recordAudit({
      action: AUDIT_ACTIONS.billingTopup,
      teamId: team.id,
      actorType: 'system',
      resourceType: 'team',
      resourceId: team.id,
      severity: 'warning',
      summary: `Automatic top-up paused after ${failureCount} failed attempts`,
      metadata: { failure, message, failureCount },
    });

    await notifyOwner(team, {
      level: 'warning',
      title: 'Automatic top-up is paused',
      body: `Karo could not charge for the last ${failureCount} attempts (${message}) and has stopped retrying. Add credit by hand — once the balance is back above ${formatMicroUsd(team.autoTopupThresholdMicroUsd)}, automatic top-up resumes on its own.`,
    });
  }

  return { status: 'failed', failure, message, gaveUp };
}

/**
 * The card was charged and the ledger write failed.
 *
 * This is the one outcome where retrying is worse than stopping: the next
 * attempt would take the money a second time, and the team would have paid twice
 * for credit they never received. So the failure budget is pushed straight to
 * the cap, which closes the claim in `attemptAutoTopup` until someone has
 * reconciled the payment by hand.
 */
async function haltAfterUncreditedCharge(
  team: Team,
  paymentId: string,
  amountMicroUsd: number,
  error: unknown,
): Promise<AutoTopupOutcome> {
  const message = `A ${formatMicroUsd(amountMicroUsd)} payment (${paymentId}) went through but could not be added to the balance.`;

  log.error('An automatic top-up was charged but not credited', {
    teamId: team.id,
    paymentId,
    amountMicroUsd,
    error,
  });

  await db
    .update(teams)
    .set({
      autoTopupFailureCount: MAX_CONSECUTIVE_FAILURES,
      autoTopupLastError: message,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, team.id));

  await recordAudit({
    action: AUDIT_ACTIONS.billingTopup,
    teamId: team.id,
    actorType: 'system',
    resourceType: 'team',
    resourceId: team.id,
    severity: 'critical',
    summary: 'An automatic top-up was charged but not credited',
    metadata: { paymentId, amountMicroUsd },
  });

  await notifyOwner(team, {
    level: 'error',
    title: 'A top-up payment needs checking',
    body: `${message} Automatic top-up is paused so the same amount cannot be taken twice; quote the payment reference when you ask for it to be sorted out.`,
  });

  return { status: 'failed', failure: 'provider_error', message, gaveUp: true };
}

/**
 * Best-effort, for the same reason the audit trail is: the money has already
 * moved by the time this runs, and a failed insert must not turn a completed
 * charge into a reported failure.
 */
async function notifyOwner(
  team: Team,
  input: { level: 'success' | 'warning' | 'error'; title: string; body: string },
): Promise<void> {
  try {
    await db.insert(notifications).values({
      id: newId(ID_PREFIX.notification),
      userId: team.ownerId,
      teamId: team.id,
      level: input.level,
      title: input.title,
      body: input.body,
      actionLabel: 'Open billing',
      actionHref: '/app/billing',
    });
  } catch (error) {
    log.error('Could not write the automatic top-up notification', { teamId: team.id, error });
  }
}
