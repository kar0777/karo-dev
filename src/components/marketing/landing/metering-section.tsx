import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { CostWidget } from '@/components/marketing/cost-widget';
import type { PlanView } from '@/components/marketing/plan-view';
import { Section, SectionIntro } from '@/components/marketing/section';
import { Button } from '@/components/ui/button';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';

/* ------------------------------------------------------------------ *
 *  Landing section 10 — pay only for what you use.
 * ------------------------------------------------------------------ */

const METERING_POINTS = [
  {
    title: 'Estimated before, itemised after',
    body: 'An expensive run is forecast before it starts and blocked if it would not fit your allowance, balance or spending cap. Afterwards every request is a row: input, output, cached and cache-write tokens with the exact multiplier applied.',
  },
  {
    title: 'Compute billed per second, not per hour',
    body: 'A sandbox accrues compute only while it is awake. It sleeps after the idle timeout on your plan and wakes on your next command in about four seconds — you are not charged for the nap.',
  },
  {
    title: 'Money is stored exactly',
    body: 'Every amount in Karo is an integer in micro-USD, so a fraction of a cent on a single request never rounds away and never compounds into a discrepancy at the end of the month.',
  },
  {
    title: 'Caps you set, not limits we impose',
    body: 'Set a hard monthly spending cap and runs that would exceed it are refused with a message naming the limit. Usage alerts fire at a threshold you choose.',
  },
];

export function MeteringSection({
  plan,
  prices,
  computeUpstreamMicroUsdPerBaseHour,
}: {
  plan: PlanView;
  prices: TokenPrices;
  computeUpstreamMicroUsdPerBaseHour: number;
}) {
  return (
    <Section id="metering" tone="inset">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-6">
          <SectionIntro
            eyebrow="Pay only for what you use"
            eyebrowTone="ember"
            title="Metering you can check, not a number you have to trust."
            description="Karo meters two things: weighted tokens and compute. Both are visible while a run is in flight, both are itemised afterwards, and both are enforced before an expensive task starts rather than after it has already spent your month."
          />

          <dl className="flex flex-col gap-4">
            {METERING_POINTS.map((point) => (
              <div key={point.title}>
                <dt className="text-[14px] font-medium text-fg">{point.title}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-muted">{point.body}</dd>
              </div>
            ))}
          </dl>

          <div>
            <Button asChild variant="outline">
              <Link href="/pricing#estimator">
                Estimate your own workload
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <CostWidget
            plan={plan}
            prices={prices}
            computeUpstreamMicroUsdPerBaseHour={computeUpstreamMicroUsdPerBaseHour}
          />
        </div>
      </div>
    </Section>
  );
}
