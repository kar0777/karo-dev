import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { paygBalances, topups } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * The one place a completed payment becomes balance.
 *
 * Stripe's webhook and the automatic top-up both land here, so the two can never
 * disagree about what "a top-up completed" means. `topups.idempotency_key` is
 * uniquely indexed and the balance moves *only* when the insert actually created
 * a row — that pairing is what makes a redelivered webhook, or a retry carrying
 * the same key, credit nothing the second time.
 */

export type CreditTopupInput = {
  teamId: string;
  /** Integer micro-USD; anything else is refused rather than half-applied. */
  amountMicroUsd: number;
  /** `topups.provider` — which implementation actually took the money. */
  provider: string;
  /** Stable per payment. Replaying it is a no-op. */
  idempotencyKey: string;
  userId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
};

/** True when this call created the top-up row and moved the balance. */
export async function creditTopup(input: CreditTopupInput): Promise<boolean> {
  // `NaN <= 0` is false, so a malformed amount would slip past a bare sign
  // check and be written to the ledger.
  if (!Number.isInteger(input.amountMicroUsd) || input.amountMicroUsd <= 0) return false;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(topups)
      .values({
        id: newId(ID_PREFIX.topup),
        teamId: input.teamId,
        userId: input.userId ?? null,
        amountMicroUsd: input.amountMicroUsd,
        status: 'succeeded',
        provider: input.provider,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
        idempotencyKey: input.idempotencyKey,
        completedAt: new Date(),
      })
      .onConflictDoNothing({ target: topups.idempotencyKey })
      .returning({ id: topups.id });

    if (inserted.length === 0) return false;

    await tx
      .update(paygBalances)
      .set({
        balanceMicroUsd: sql`${paygBalances.balanceMicroUsd} + ${input.amountMicroUsd}`,
        lifetimeToppedUpMicroUsd: sql`${paygBalances.lifetimeToppedUpMicroUsd} + ${input.amountMicroUsd}`,
        updatedAt: new Date(),
      })
      .where(eq(paygBalances.teamId, input.teamId));

    return true;
  });
}
