'use client';

import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  useBillingMutation,
  postJson,
  type BillingRedirect,
} from '@/components/billing/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input, InputAddon, InputGroup } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn, formatMicroUsd } from '@/lib/utils';
import { describeError } from '@/lib/client/api';

/**
 * Pay-as-you-go balance and top-ups.
 *
 * The amount is entered in dollars because that is how people think about
 * money, and converted to integer micro-USD before it leaves the browser —
 * the API never sees a float.
 */

const MICRO_PER_USD = 1_000_000;

export interface BalanceCardProps {
  balanceMicroUsd: number;
  creditLimitMicroUsd: number;
  lifetimeToppedUpMicroUsd: number;
  lifetimeSpentMicroUsd: number;
  minTopupMicroUsd: number;
  autoTopupEnabled: boolean;
  autoTopupThresholdMicroUsd: number;
  autoTopupAmountMicroUsd: number;
  canManage: boolean;
  isSimulated: boolean;
}

const PRESET_USD = [10, 25, 50, 100, 250];

function usdToMicro(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * MICRO_PER_USD);
}

function microToUsdInput(micro: number): string {
  if (micro <= 0) return '';
  return String(Math.round((micro / MICRO_PER_USD) * 100) / 100);
}

export function BalanceCard(props: BalanceCardProps) {
  const { pendingKey, run } = useBillingMutation();

  const presets = React.useMemo(() => {
    const usable = PRESET_USD.map((usd) => usd * MICRO_PER_USD).filter(
      (micro) => micro >= props.minTopupMicroUsd,
    );
    if (usable.length > 0) return usable.slice(0, 4);
    return [props.minTopupMicroUsd, props.minTopupMicroUsd * 2, props.minTopupMicroUsd * 5];
  }, [props.minTopupMicroUsd]);

  const [amount, setAmount] = React.useState(() =>
    microToUsdInput(presets[0] ?? props.minTopupMicroUsd),
  );
  const [amountError, setAmountError] = React.useState<string | null>(null);

  const [autoEnabled, setAutoEnabled] = React.useState(props.autoTopupEnabled);
  const [autoThreshold, setAutoThreshold] = React.useState(() =>
    microToUsdInput(props.autoTopupThresholdMicroUsd),
  );
  const [autoAmount, setAutoAmount] = React.useState(() =>
    microToUsdInput(props.autoTopupAmountMicroUsd),
  );

  const micro = usdToMicro(amount);
  const belowMinimum = micro !== null && micro < props.minTopupMicroUsd;
  const negative = props.balanceMicroUsd < 0;

  async function topUp() {
    if (micro === null) {
      setAmountError('Enter an amount, for example 25.');
      return;
    }
    if (micro < props.minTopupMicroUsd) {
      setAmountError(`The minimum top-up is ${formatMicroUsd(props.minTopupMicroUsd)}.`);
      return;
    }
    setAmountError(null);

    await run(
      'topup',
      () => postJson<BillingRedirect>('/api/billing/topup', { amountMicroUsd: micro }),
      { redirect: (result) => result.url },
    );
  }

  async function saveAutoTopup(nextEnabled: boolean) {
    const threshold = usdToMicro(autoThreshold) ?? 0;
    const value = usdToMicro(autoAmount) ?? 0;

    await run(
      'auto-topup',
      () =>
        postJson<{ ok: boolean }>(
          '/api/billing/controls',
          {
            autoTopupEnabled: nextEnabled,
            autoTopupThresholdMicroUsd: threshold,
            autoTopupAmountMicroUsd: value,
          },
          'PATCH',
        ),
      {
        success: () => ({
          title: nextEnabled ? 'Auto top-up on' : 'Auto top-up off',
          description: nextEnabled
            ? `Karo will add ${formatMicroUsd(value)} whenever the balance falls below ${formatMicroUsd(threshold)}.`
            : 'Your balance will no longer be topped up automatically.',
        }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-ember" aria-hidden="true" />
            Pay-as-you-go balance
          </CardTitle>
          <CardDescription>
            Covers anything past your included allowance, and everything on a pay-as-you-go
            plan.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">
              Available
            </p>
            <p
              className={cn(
                'karo-numeric mt-0.5 text-2xl leading-none font-semibold',
                negative ? 'text-danger' : 'text-ember',
              )}
            >
              {formatMicroUsd(props.balanceMicroUsd)}
            </p>
          </div>
          <dl className="karo-numeric grid grid-cols-3 gap-x-4 gap-y-0.5 text-right text-[11px]">
            <dt className="text-subtle">Credit limit</dt>
            <dt className="text-subtle">Topped up</dt>
            <dt className="text-subtle">Spent</dt>
            <dd className="text-fg">{formatMicroUsd(props.creditLimitMicroUsd)}</dd>
            <dd className="text-fg">{formatMicroUsd(props.lifetimeToppedUpMicroUsd)}</dd>
            <dd className="text-fg">{formatMicroUsd(props.lifetimeSpentMicroUsd)}</dd>
          </dl>
        </div>

        {negative ? (
          <Alert variant="warning">
            <AlertTitle>Your balance is negative</AlertTitle>
            <AlertDescription>
              Runs continue until the balance reaches{' '}
              {formatMicroUsd(-props.creditLimitMicroUsd)} — the credit limit that covers the
              tail of an in-flight run. Add credit to keep the agent working.
            </AlertDescription>
          </Alert>
        ) : null}

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-fg">Add credit</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset amounts">
            {presets.map((preset) => {
              const selected = micro === preset;
              return (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  onClick={() => {
                    setAmount(microToUsdInput(preset));
                    setAmountError(null);
                  }}
                  disabled={!props.canManage || pendingKey !== null}
                  aria-pressed={selected}
                >
                  {formatMicroUsd(preset)}
                  {preset >= 100_000_000 ? (
                    <span className="ml-1 text-[10px] text-primary">+10%</span>
                  ) : preset >= 50_000_000 ? (
                    <span className="ml-1 text-[10px] text-primary">+5%</span>
                  ) : null}
                </Button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="topup-amount">Amount</FieldLabel>
              <InputGroup>
                <InputAddon>$</InputAddon>
                <Input
                  id="topup-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setAmountError(null);
                  }}
                  disabled={!props.canManage || pendingKey !== null}
                  aria-describedby="topup-amount-hint"
                  aria-invalid={amountError ? true : undefined}
                />
              </InputGroup>
              {amountError ? (
                <FieldError>{amountError}</FieldError>
              ) : (
                <FieldHint id="topup-amount-hint">
                  Bigger top-ups earn bonus credit: +5% from $50, +10% from $100. Minimum{' '}
                  {formatMicroUsd(props.minTopupMicroUsd)}.{' '}
                  {props.isSimulated
                    ? 'Simulated checkout credits the balance instantly.'
                    : 'You will be taken to a secure checkout page.'}
                </FieldHint>
              )}
            </Field>
            <div>
              <Button
                size="sm"
                onClick={() => void topUp()}
                loading={pendingKey === 'topup'}
                disabled={
                  !props.canManage || pendingKey !== null || micro === null || belowMinimum
                }
              >
                Add {micro !== null ? formatMicroUsd(micro) : 'credit'}
              </Button>
            </div>
          </div>
        </div>

        <PromoCode canManage={props.canManage} />

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-fg">Automatic top-up</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                Keeps long agent runs from stopping halfway.{' '}
                {props.isSimulated
                  ? 'Simulated billing credits the balance as soon as it drops below your threshold, without charging a card.'
                  : 'Karo charges the saved payment method as soon as the balance drops below your threshold.'}
              </p>
            </div>
            <Switch
              checked={autoEnabled}
              onCheckedChange={(checked) => {
                setAutoEnabled(checked);
                void saveAutoTopup(checked);
              }}
              disabled={!props.canManage || pendingKey !== null}
              aria-label="Enable automatic top-up"
            />
          </div>

          <div
            className={cn(
              'grid grid-cols-1 gap-3 sm:grid-cols-2',
              !autoEnabled && 'pointer-events-none opacity-55',
            )}
          >
            <Field>
              <FieldLabel htmlFor="auto-topup-threshold">When balance falls below</FieldLabel>
              <InputGroup>
                <InputAddon>$</InputAddon>
                <Input
                  id="auto-topup-threshold"
                  inputMode="decimal"
                  autoComplete="off"
                  value={autoThreshold}
                  onChange={(event) => setAutoThreshold(event.target.value)}
                  disabled={!props.canManage || !autoEnabled || pendingKey !== null}
                />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="auto-topup-amount">Add this much</FieldLabel>
              <InputGroup>
                <InputAddon>$</InputAddon>
                <Input
                  id="auto-topup-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={autoAmount}
                  onChange={(event) => setAutoAmount(event.target.value)}
                  disabled={!props.canManage || !autoEnabled || pendingKey !== null}
                />
              </InputGroup>
              <FieldHint>Must be larger than the threshold.</FieldHint>
            </Field>
          </div>

          {autoEnabled ? (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveAutoTopup(true)}
                loading={pendingKey === 'auto-topup'}
                disabled={!props.canManage || pendingKey !== null}
              >
                Save auto top-up
              </Button>
            </div>
          ) : null}
        </div>

        {!props.canManage ? (
          <p className="text-[12px] text-subtle">
            Only a team owner can add credit or change auto top-up.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Promo codes
 * ------------------------------------------------------------------ */

/**
 * The single place a Karo coupon is redeemed: here, in Billing — never at the
 * payment page. A credit lands on the balance at once; a plan discount is
 * recorded and prices the next subscription checkout for that tier.
 */
function PromoCode({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function redeem() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await postJson<{
        kind: 'credit' | 'plan_discount';
        amountMicroUsd?: number;
        percentOff?: number;
        planTier?: string;
      }>('/api/billing/coupons/redeem', { code: code.trim() });

      if (result.kind === 'credit') {
        setMessage({
          ok: true,
          text: `Credited ${formatMicroUsd(result.amountMicroUsd ?? 0)} of bonus balance.`,
        });
      } else {
        setMessage({
          ok: true,
          text: `${result.percentOff}% off the ${result.planTier} plan is locked in — it will price your next subscription checkout.`,
        });
      }
      setCode('');
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: describeError(error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg">Have a promo code?</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void redeem();
        }}
      >
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor="promo-code">Promo code</FieldLabel>
          <Input
            id="promo-code"
            autoComplete="off"
            placeholder="KARO-XXXX-XXXX"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={!canManage || busy}
          />
        </Field>
        <Button size="sm" type="submit" loading={busy} disabled={!canManage || !code.trim()}>
          Apply
        </Button>
      </form>
      {message ? (
        <p
          className={cn(
            'mt-1.5 text-[11.5px] leading-snug',
            message.ok ? 'text-primary' : 'text-danger',
          )}
        >
          {message.text}
        </p>
      ) : (
        <FieldHint>
          Codes are applied here in Billing — bonus credit or a plan discount.
        </FieldHint>
      )}
    </div>
  );
}
