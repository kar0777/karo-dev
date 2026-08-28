'use client';

import { CalendarClock, ExternalLink, Sparkles } from 'lucide-react';
import * as React from 'react';

import {
  useBillingMutation,
  postJson,
  type BillingRedirect,
} from '@/components/billing/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatCompactNumber, formatDate, formatMicroUsd } from '@/lib/utils';

/**
 * The current subscription, and the things you can do to it.
 *
 * Cancelling is the only destructive action here, so it is the only one behind
 * a confirmation — and the confirmation states exactly what stays working and
 * for how long.
 *
 * A downgrade does not take effect when it is requested, so it would otherwise
 * be invisible between the click and the period boundary. It is shown here,
 * with the date it lands and a way to call it off.
 */

export interface CurrentPlanCardProps {
  planId: string;
  planName: string;
  planTagline: string;
  planTier: string;
  hasSubscription: boolean;
  status: string;
  interval: 'month' | 'year';
  priceMicroUsd: number;
  currentPeriodEndIso: string | null;
  cancelAtPeriodEnd: boolean;
  /** The plan a scheduled change moves to; `null` when nothing is scheduled. */
  scheduledPlanName: string | null;
  scheduledInterval: 'month' | 'year' | null;
  scheduledEffectiveAtIso: string | null;
  trialEndsAtIso: string | null;
  includedWeightedTokens: number;
  includedComputeHours: number;
  canManage: boolean;
  isSimulated: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  canceled: 'Cancelled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  unpaid: 'Unpaid',
  paused: 'Paused',
};

function statusVariant(status: string, cancelAtPeriodEnd: boolean): BadgeProps['variant'] {
  if (cancelAtPeriodEnd) return 'warning';
  switch (status) {
    case 'active':
      return 'success';
    case 'trialing':
      return 'primary';
    case 'past_due':
    case 'unpaid':
      return 'danger';
    case 'canceled':
    case 'incomplete_expired':
      return 'neutral';
    default:
      return 'warning';
  }
}

export function CurrentPlanCard(props: CurrentPlanCardProps) {
  const { pendingKey, run } = useBillingMutation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const periodEnd = props.currentPeriodEndIso ? formatDate(props.currentPeriodEndIso) : null;
  const scheduledOn = props.scheduledEffectiveAtIso
    ? formatDate(props.scheduledEffectiveAtIso)
    : null;

  /** Asking for the plan you are already on is what cancels a scheduled change. */
  async function keepCurrentPlan() {
    await run(
      'unschedule',
      () =>
        postJson<{ ok: boolean }>(
          '/api/billing/subscription',
          { action: 'change', planId: props.planId, interval: props.interval },
          'PATCH',
        ),
      {
        success: () => ({
          title: `Staying on ${props.planName}`,
          description: 'The scheduled change was called off. Nothing about your plan changes.',
        }),
      },
    );
  }

  async function cancel() {
    setConfirmOpen(false);
    await run(
      'cancel',
      () =>
        postJson<{ ok: boolean }>('/api/billing/subscription', { action: 'cancel' }, 'PATCH'),
      {
        success: () => ({
          title: 'Subscription will end at the period close',
          description: periodEnd
            ? `Everything keeps working until ${periodEnd}. You can resume any time before then.`
            : 'Everything keeps working until the current period ends.',
        }),
      },
    );
  }

  async function resume() {
    await run(
      'resume',
      () =>
        postJson<{ ok: boolean }>('/api/billing/subscription', { action: 'resume' }, 'PATCH'),
      {
        success: () => ({
          title: 'Subscription resumed',
          description: 'Your plan renews as normal — nothing was interrupted.',
        }),
      },
    );
  }

  async function openPortal() {
    await run('portal', () => postJson<BillingRedirect>('/api/billing/portal', {}), {
      redirect: (result) => result.url,
    });
  }

  return (
    <section
      aria-labelledby="current-plan-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Current plan
          </p>
          <h2
            id="current-plan-title"
            className="mt-1 flex flex-wrap items-center gap-2 text-lg leading-tight font-semibold text-fg"
          >
            {props.planName}
            <Badge variant={statusVariant(props.status, props.cancelAtPeriodEnd)} size="sm">
              {props.cancelAtPeriodEnd
                ? 'Ends at period close'
                : (STATUS_LABEL[props.status] ?? props.status)}
            </Badge>
          </h2>
          {props.planTagline ? (
            <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted">
              {props.planTagline}
            </p>
          ) : null}
        </div>

        <div className="text-right">
          <p className="karo-numeric text-lg leading-tight font-semibold text-fg">
            {props.priceMicroUsd > 0 ? formatMicroUsd(props.priceMicroUsd) : 'No fixed fee'}
          </p>
          <p className="text-[11px] text-subtle">
            {props.priceMicroUsd > 0
              ? props.interval === 'year'
                ? 'per year'
                : 'per month'
              : 'usage only'}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        <Fact
          label="Included tokens"
          value={
            props.includedWeightedTokens > 0
              ? `${formatCompactNumber(props.includedWeightedTokens)} weighted`
              : 'None — billed per use'
          }
        />
        <Fact
          label="Included compute"
          value={
            props.includedComputeHours > 0
              ? `${props.includedComputeHours.toFixed(0)} hours`
              : 'None — billed per second'
          }
        />
        <Fact label={props.cancelAtPeriodEnd ? 'Ends' : 'Renews'} value={periodEnd ?? '—'} />
        <Fact
          label="Billing"
          value={props.hasSubscription ? `Every ${props.interval}` : 'Pay as you go'}
        />
      </div>

      {props.cancelAtPeriodEnd ? (
        <div className="px-4 pt-4">
          <Alert variant="warning">
            <AlertTitle>
              This subscription ends {periodEnd ? `on ${periodEnd}` : 'soon'}
            </AlertTitle>
            <AlertDescription>
              Agents, sandboxes and projects keep working until then. After that the team moves
              to pay-as-you-go and runs are charged to your balance. Resume any time before the
              end date to keep your allowance.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {props.scheduledPlanName ? (
        <div className="px-4 pt-4">
          {props.cancelAtPeriodEnd ? (
            <Alert variant="info" icon={CalendarClock}>
              <AlertTitle>The move to {props.scheduledPlanName} will not go ahead</AlertTitle>
              <AlertDescription>
                Cancelling takes precedence: with no period after this one there is nothing for
                the change to apply to, so it will be dropped instead. Resume the subscription
                before the end date if you want it to happen.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="primary" icon={CalendarClock}>
              <AlertTitle>
                Moving to {props.scheduledPlanName}{' '}
                {scheduledOn ? `on ${scheduledOn}` : 'at the period close'}
              </AlertTitle>
              <AlertDescription>
                You keep {props.planName} and its full allowance until then — this period is
                already paid for. On that date the plan becomes {props.scheduledPlanName}
                {props.scheduledInterval ? `, billed every ${props.scheduledInterval}` : ''},
                and it bills at that plan&rsquo;s rate from then on.
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void keepCurrentPlan()}
                    loading={pendingKey === 'unschedule'}
                    disabled={!props.canManage || pendingKey !== null}
                  >
                    Keep {props.planName}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}

      {props.status === 'past_due' || props.status === 'unpaid' ? (
        <div className="px-4 pt-4">
          <Alert variant="danger">
            <AlertTitle>The last payment did not go through</AlertTitle>
            <AlertDescription>
              Runs are blocked until the balance is settled. Update the payment method in the
              billing portal, then retry — nothing in your projects has been touched.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {props.trialEndsAtIso ? (
        <div className="px-4 pt-4">
          <Alert variant="primary" icon={Sparkles}>
            <AlertTitle>Trial ends {formatDate(props.trialEndsAtIso)}</AlertTitle>
            <AlertDescription>
              After that the plan bills normally. Cancel before the end date and you will not be
              charged.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-[11px] text-subtle">
          {props.canManage
            ? 'Upgrades take effect immediately and are prorated; downgrades apply when the current period ends.'
            : 'Only a team owner can change the plan or cancel.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href="#plans">
              <CalendarClock aria-hidden="true" />
              Change plan
            </a>
          </Button>

          {props.hasSubscription && props.cancelAtPeriodEnd ? (
            <Button
              size="sm"
              onClick={() => void resume()}
              loading={pendingKey === 'resume'}
              disabled={!props.canManage || pendingKey !== null}
            >
              Resume subscription
            </Button>
          ) : null}

          {props.hasSubscription && !props.cancelAtPeriodEnd ? (
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!props.canManage || pendingKey !== null}
                >
                  Cancel plan
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel {props.planName}?</DialogTitle>
                  <DialogDescription>
                    The subscription stays active until{' '}
                    {periodEnd ?? 'the end of the current period'} — you keep the full allowance
                    you already paid for. After that the team moves to pay-as-you-go and runs
                    are charged to your balance. Nothing is deleted, and you can resume before
                    the end date.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary" size="sm">
                      Keep my plan
                    </Button>
                  </DialogClose>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void cancel()}
                    loading={pendingKey === 'cancel'}
                  >
                    Cancel at period end
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}

          {!props.isSimulated ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void openPortal()}
              loading={pendingKey === 'portal'}
              disabled={!props.canManage || pendingKey !== null}
            >
              <ExternalLink aria-hidden="true" />
              Payment methods
            </Button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</p>
      <p className="karo-numeric mt-1 text-[13px] font-medium text-fg">{value}</p>
    </div>
  );
}
