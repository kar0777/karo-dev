import { ArrowRight, Info } from 'lucide-react';
import Link from 'next/link';

import { PlanCard } from '@/components/marketing/plan-card';
import {
  type CatalogSource,
  LANDING_PLAN_KEYS,
  planByKey,
  type PlanView,
} from '@/components/marketing/plan-view';
import { Section, SectionIntro } from '@/components/marketing/section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/* ------------------------------------------------------------------ *
 *  Landing section 13 — pricing preview.
 *
 *  Reads the `plans` table. When the catalogue is unreachable the page
 *  still renders from the published seed values and says so, because a
 *  500 on the landing page is worse than a stale number with a caveat.
 * ------------------------------------------------------------------ */

export function PricingPreview({
  plans,
  source,
}: {
  plans: readonly PlanView[];
  source: CatalogSource;
}) {
  const featured = LANDING_PLAN_KEYS.map((key) => planByKey(plans, key)).filter(
    (plan): plan is PlanView => plan !== undefined,
  );
  const payg = planByKey(plans, 'payg');

  return (
    <Section id="pricing">
      <SectionIntro
        eyebrow="Pricing"
        eyebrowTone="ember"
        title="A plan for the allowance, metering for everything past it."
        description="Subscriptions bundle weighted tokens, compute hours and machine sizes. Go past the allowance and you pay the plan's published overage rate — or skip the subscription entirely and pay as you go."
      />

      {source === 'fallback' ? (
        <Alert variant="info" icon={Info} className="mt-6 max-w-3xl">
          <AlertDescription>
            Live plan data is temporarily unavailable, so these are the published catalogue
            values. Prices shown at checkout are always the live ones — if the two ever differ,
            checkout wins.
          </AlertDescription>
        </Alert>
      ) : null}

      {featured.length === 0 ? (
        <Alert variant="warning" className="mt-6 max-w-3xl">
          <AlertDescription>
            No public plans are configured right now. See{' '}
            <Link href="/pricing" className="underline underline-offset-2">
              the pricing page
            </Link>{' '}
            for the full catalogue, or contact support if this persists.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((plan) => (
            <PlanCard key={plan.key} plan={plan} interval="month" maxFeatures={5} />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-muted">
          {payg
            ? `${payg.name}: ${payg.tagline} No subscription, no expiry — top up and spend it.`
            : 'Prefer no subscription? Pay as you go bills upstream cost plus a flat platform margin.'}
        </p>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/pricing">
            All five plans and the estimator
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
