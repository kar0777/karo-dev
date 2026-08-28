'use client';

import { BellRing } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/components/ui/toast';
import { ApiClientError, apiFetch, describeError } from '@/lib/client/api';
import { formatNumber, formatPercent } from '@/lib/utils';

/**
 * Usage alerting: one number, but the one number people actually want to
 * change. The preview line turns the percentage into tokens so the choice is
 * made against a real quantity rather than an abstraction.
 */

export interface UsageAlertsCardProps {
  threshold: number;
  includedWeightedTokens: number;
  canManage: boolean;
}

const MIN = 0.5;
const MAX = 1;
const STEP = 0.05;

export function UsageAlertsCard({
  threshold,
  includedWeightedTokens,
  canManage,
}: UsageAlertsCardProps) {
  const router = useRouter();
  const [value, setValue] = React.useState(() => clampThreshold(threshold));
  const [saved, setSaved] = React.useState(() => clampThreshold(threshold));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = Math.abs(value - saved) > 0.001;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/usage/alerts', {
        method: 'PATCH',
        json: { threshold: Number(value.toFixed(2)) },
      });
      setSaved(value);
      toast.success('Usage alert updated', {
        description: `Karo will notify the team at ${formatPercent(value)} of the included allowance.`,
      });
      router.refresh();
    } catch (caught) {
      const described =
        caught instanceof ApiClientError
          ? { title: caught.title, message: caught.message }
          : describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  const triggerTokens = Math.round(includedWeightedTokens * value);

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-4 text-ember" aria-hidden="true" />
            Usage alerts
          </CardTitle>
          <CardDescription>
            Karo notifies the team once this share of the included allowance is spent, so nobody
            discovers the limit by hitting it mid-run.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="usage-alert-threshold">Alert threshold</Label>
          <output
            htmlFor="usage-alert-threshold"
            className="karo-numeric text-sm font-semibold text-ember"
          >
            {formatPercent(value)}
          </output>
        </div>

        <Slider
          id="usage-alert-threshold"
          min={MIN}
          max={MAX}
          step={STEP}
          value={[value]}
          onValueChange={([next]) => setValue(clampThreshold(next ?? value))}
          disabled={!canManage || saving}
          aria-label="Usage alert threshold"
          aria-valuetext={formatPercent(value)}
        />

        <div className="karo-numeric flex justify-between text-[11px] text-subtle">
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          {includedWeightedTokens > 0 ? (
            <>
              Fires at{' '}
              <span className="karo-numeric font-medium text-fg">
                {formatNumber(triggerTokens)}
              </span>{' '}
              of {formatNumber(includedWeightedTokens)} included weighted tokens.
            </>
          ) : (
            <>
              Your current plan has no included allowance, so this threshold applies from the
              moment a plan with included weighted tokens is active.
            </>
          )}
        </p>

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!canManage ? (
          <p className="text-[12px] text-subtle">
            Only an owner can change this. Ask a team owner to adjust the threshold.
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        <span className="text-[11px] text-subtle">{dirty ? 'Unsaved change' : 'Saved'}</span>
        <Button
          size="sm"
          onClick={() => void save()}
          loading={saving}
          disabled={!canManage || !dirty}
        >
          Save threshold
        </Button>
      </CardFooter>
    </Card>
  );
}

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(MAX, Math.max(MIN, value));
}
