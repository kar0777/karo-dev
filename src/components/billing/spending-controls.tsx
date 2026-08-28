'use client';

import { ShieldAlert } from 'lucide-react';
import * as React from 'react';

import { useBillingMutation, postJson } from '@/components/billing/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input, InputAddon, InputGroup } from '@/components/ui/input';
import { Meter } from '@/components/ui/meter';
import { formatMicroUsd } from '@/lib/utils';

/**
 * The hard stop on monthly spend.
 *
 * The important part of this card is not the input — it is the paragraph that
 * says exactly what happens when the cap is reached, because a limit whose
 * consequence is unknown gets set to zero.
 */

const MICRO_PER_USD = 1_000_000;

export interface SpendingControlsProps {
  spendCapMicroUsd: number;
  periodSpendMicroUsd: number;
  periodEndIso: string;
  canManage: boolean;
}

function usdToMicro(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number.parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * MICRO_PER_USD);
}

export function SpendingControls(props: SpendingControlsProps) {
  const { pendingKey, run } = useBillingMutation();
  const [value, setValue] = React.useState(() =>
    props.spendCapMicroUsd > 0
      ? String(Math.round((props.spendCapMicroUsd / MICRO_PER_USD) * 100) / 100)
      : '',
  );
  const [error, setError] = React.useState<string | null>(null);

  const parsed = usdToMicro(value);
  const dirty = parsed !== null && parsed !== props.spendCapMicroUsd;
  const capped = props.spendCapMicroUsd > 0;
  const reached = capped && props.periodSpendMicroUsd >= props.spendCapMicroUsd;

  async function save() {
    if (parsed === null) {
      setError('Enter a positive amount, or leave it empty for no cap.');
      return;
    }
    setError(null);

    await run(
      'cap',
      () =>
        postJson<{ ok: boolean }>(
          '/api/billing/controls',
          { spendCapMicroUsd: parsed },
          'PATCH',
        ),
      {
        success: () => ({
          title: parsed > 0 ? 'Spending cap updated' : 'Spending cap removed',
          description:
            parsed > 0
              ? `Runs are blocked once this period passes ${formatMicroUsd(parsed)}.`
              : 'Spend is no longer capped for this team.',
        }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-ember" aria-hidden="true" />
            Monthly spending cap
          </CardTitle>
          <CardDescription>
            A hard ceiling on what this team can spend in one billing period.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {capped ? (
          <Meter
            value={props.periodSpendMicroUsd}
            max={props.spendCapMicroUsd}
            label="Spent against the cap"
            caption={`${formatMicroUsd(props.periodSpendMicroUsd)} / ${formatMicroUsd(props.spendCapMicroUsd)}`}
            showPercent
          />
        ) : null}

        {reached ? (
          <Alert variant="danger">
            <AlertTitle>The cap for this period has been reached</AlertTitle>
            <AlertDescription>
              New agent runs and sandbox starts are blocked until the period resets. Raise the
              cap below to continue now — nothing in your projects was lost, and work already
              done is saved.
            </AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="spend-cap">Cap</FieldLabel>
          <InputGroup>
            <InputAddon>$</InputAddon>
            <Input
              id="spend-cap"
              inputMode="decimal"
              autoComplete="off"
              placeholder="No cap"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              disabled={!props.canManage || pendingKey !== null}
              aria-describedby="spend-cap-hint"
              aria-invalid={error ? true : undefined}
            />
            <InputAddon filled={false}>per period</InputAddon>
          </InputGroup>
          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldHint id="spend-cap-hint">Leave empty for no cap.</FieldHint>
          )}
        </Field>

        <div className="rounded-md border border-line bg-bg-inset p-3">
          <p className="text-[12px] font-medium text-fg">What happens when the cap is hit</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-muted">
            <li>
              New agent runs and sandbox starts are refused with a clear message pointing back
              here.
            </li>
            <li>
              A run already in flight is allowed to finish — stopping mid-edit would leave a
              project in a half-written state.
            </li>
            <li>
              Reading projects, files, chat history and this page keeps working. Nothing is
              deleted or archived.
            </li>
            <li>The cap resets when the billing period does.</li>
          </ul>
        </div>
      </CardContent>

      <CardFooter>
        <span className="text-[11px] text-subtle">
          {capped
            ? `Resets ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(props.periodEndIso))}`
            : 'No cap set — spend is limited only by your balance and plan.'}
        </span>
        <Button
          size="sm"
          onClick={() => void save()}
          loading={pendingKey === 'cap'}
          disabled={!props.canManage || !dirty || pendingKey !== null}
        >
          Save cap
        </Button>
      </CardFooter>
    </Card>
  );
}
