import { Info, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LatticeBackdrop } from '@/components/brand/lattice';
import {
  defaultPricingModel,
  loadPublicModels,
  loadPublicPlans,
} from '@/components/marketing/catalog.server';
import { CostEstimator } from '@/components/marketing/cost-estimator';
import { FaqAccordion } from '@/components/marketing/faq-accordion';
import { PRICING_FAQ } from '@/components/marketing/faq-data';
import { breadcrumbJsonLd, faqPageJsonLd, JsonLd } from '@/components/marketing/json-ld';
import { PricingPlans } from '@/components/marketing/pricing-plans';
import {
  ComputeUnitExplainer,
  WeightedTokenExplainer,
} from '@/components/marketing/pricing-explainers';
import { CONTAINER, DiamondList, Section, SectionIntro } from '@/components/marketing/section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { buildMetadata } from '@/lib/metadata';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';
import { getSetting, SETTING_KEYS, settingDefault } from '@/lib/settings';

/** Plan quotas, model prices and the compute rate are admin-editable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Pricing',
  description:
    'Five plans, one honest unit. Compare every limit, understand weighted tokens and compute hours, and estimate your own monthly cost with the same functions Karo bills with.',
  path: '/pricing',
});

/** Only reached when the catalogue has no priced model at all. */
const NEUTRAL_PRICES: TokenPrices = {
  inputMicroUsdPerMtok: 3_000_000,
  outputMicroUsdPerMtok: 15_000_000,
  cachedInputMicroUsdPerMtok: 300_000,
  cacheWriteMicroUsdPerMtok: 3_750_000,
};

const OVERAGE_NOTES = [
  'Overage is billed at the plan’s published rate per million weighted tokens and per compute hour. Larger plans publish lower rates.',
  'A plan that publishes no rate bills overage at upstream cost plus the platform margin — that is what a zero in the table means, not “free”.',
  'Set a hard monthly spending cap and runs that would exceed it are refused before they start, with a message naming the limit.',
  'An expensive task is estimated before it runs and checked against your allowance, balance and cap. You are told in advance, not after.',
  'Unused allowance does not roll over. If your usage is spiky, a smaller plan plus overage usually costs less than a plan sized for your worst month.',
  'Upgrades apply immediately and are prorated; downgrades apply at the end of the current period.',
];

const FAIR_USE = [
  'Sandboxes are for building, testing and running your own software. That includes production workloads on the plans that allow them.',
  'Not allowed: crypto mining, bulk scraping of third-party sites, credential stuffing, spam or bulk mail, torrenting, and reselling raw compute.',
  'Concurrency, queue priority and machine size are plan limits, not judgement calls — the throttling you meet day to day is a number you can read in the table above.',
  'Sustained abuse suspends the offending sandbox first and the account only if it continues. You are told which rule was hit and given a way to reply.',
];

export default async function PricingPage() {
  const [planCatalog, modelCatalog, computeUpstreamMicroUsdPerBaseHour] = await Promise.all([
    loadPublicPlans(),
    loadPublicModels(),
    getSetting(
      SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour,
      settingDefault(SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour),
    ),
  ]);

  const pricingModel = defaultPricingModel(modelCatalog.models);
  const prices: TokenPrices = pricingModel
    ? {
        inputMicroUsdPerMtok: pricingModel.inputMicroUsdPerMtok,
        outputMicroUsdPerMtok: pricingModel.outputMicroUsdPerMtok,
        cachedInputMicroUsdPerMtok: pricingModel.cachedInputMicroUsdPerMtok,
        cacheWriteMicroUsdPerMtok: pricingModel.cacheWriteMicroUsdPerMtok,
      }
    : NEUTRAL_PRICES;

  return (
    <>
      <JsonLd
        data={[
          faqPageJsonLd(PRICING_FAQ, '/pricing'),
          breadcrumbJsonLd([{ name: 'Pricing', path: '/pricing' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={50} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Pricing"
            eyebrowTone="ember"
            title="Pay for the machine and the tokens. Nothing else."
            description="Five plans and one metering model. Subscriptions bundle an allowance; pay as you go bundles nothing and charges upstream cost plus a flat margin. Every figure on this page is read from the live plan catalogue."
            as="h1"
          />
        </div>
      </section>

      <Section id="plans" divider={false} size="sm">
        {planCatalog.source === 'fallback' ? (
          <Alert variant="info" icon={Info} className="mb-6 max-w-3xl">
            <AlertTitle>Showing the published catalogue</AlertTitle>
            <AlertDescription>
              Live plan data could not be read just now, so these are the published values.
              Checkout always uses the live catalogue — if the two ever differ, checkout wins.
            </AlertDescription>
          </Alert>
        ) : null}

        <PricingPlans plans={planCatalog.plans} />
      </Section>

      <Section id="weighted-tokens" tone="inset">
        <SectionIntro
          eyebrow="Unit one"
          title="Weighted tokens"
          description="The unit your model allowance is measured in, and why it is not simply “tokens”."
          className="mb-8"
        />
        <WeightedTokenExplainer model={pricingModel} prices={prices} />
      </Section>

      <Section id="compute-units">
        <SectionIntro
          eyebrow="Unit two"
          eyebrowTone="ember"
          title="Compute units"
          description="The unit your machine time is measured in, and exactly how a bigger machine changes it."
          className="mb-8"
        />
        <ComputeUnitExplainer />
      </Section>

      <Section id="estimator" tone="inset">
        <SectionIntro
          eyebrow="Estimator"
          title="Estimate your own month."
          description="Move the sliders. The result comes from settleModelUsage and settleComputeUsage — the same functions that settle a real request — against the live price sheet."
          className="mb-8"
        />
        <CostEstimator
          plans={planCatalog.plans}
          models={modelCatalog.models}
          computeUpstreamMicroUsdPerBaseHour={computeUpstreamMicroUsdPerBaseHour}
        />
      </Section>

      <Section id="overage">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-5">
            <SectionIntro
              eyebrow="Overage"
              eyebrowTone="ember"
              title="What happens past the allowance."
              description="Nothing silently. Karo would rather block a run and tell you why than hand you an invoice you did not expect."
            />
            <DiamondList items={OVERAGE_NOTES} tone="ember" />
          </div>

          <div className="flex flex-col gap-5">
            <SectionIntro
              eyebrow="Fair use"
              eyebrowTone="muted"
              title="The short version of the rules."
              description="Karo gives you a real machine with real network access. The limits exist so one tenant cannot ruin the fleet for everyone else."
            />
            <DiamondList items={FAIR_USE} tone="line" />
            <Alert variant="warning" icon={ShieldAlert}>
              <AlertTitle>Abuse is handled per sandbox first</AlertTitle>
              <AlertDescription>
                A sandbox that trips a fair-use rule is stopped and you are told which rule and
                what to change. Accounts are only suspended when the behaviour continues after
                that.
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </Section>

      <Section id="faq" tone="inset">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] lg:gap-14">
          <SectionIntro
            eyebrow="Questions"
            title="Pricing questions, answered plainly."
            description="Anything about how the agent actually works is answered on the landing page and in the documentation."
          >
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/docs#billing">Billing documentation</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/register">Start building</Link>
              </Button>
            </div>
          </SectionIntro>

          <FaqAccordion entries={PRICING_FAQ} idPrefix="pricing" />
        </div>
      </Section>
    </>
  );
}
