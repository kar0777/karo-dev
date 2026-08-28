import type { Metadata } from 'next';

import {
  defaultPricingModel,
  loadPublicModels,
  loadPublicPlans,
} from '@/components/marketing/catalog.server';
import { LANDING_FAQ } from '@/components/marketing/faq-data';
import { faqPageJsonLd, JsonLd } from '@/components/marketing/json-ld';
import {
  ByosSection,
  DockerSection,
  SandboxSection,
  TerminalSection,
} from '@/components/marketing/landing/capability-sections';
import {
  FaqSection,
  FinalCta,
  SecuritySection,
} from '@/components/marketing/landing/assurance-sections';
import {
  McpSection,
  SkillsSection,
  UseCasesSection,
} from '@/components/marketing/landing/ecosystem-sections';
import { Hero } from '@/components/marketing/landing/hero';
import { MeteringSection } from '@/components/marketing/landing/metering-section';
import { ModelsSection } from '@/components/marketing/landing/models-section';
import { PricingPreview } from '@/components/marketing/landing/pricing-preview';
import { isSubscriptionPlan, planByKey } from '@/components/marketing/plan-view';
import { Section, SectionIntro } from '@/components/marketing/section';
import { WorkspaceDemo } from '@/components/marketing/workspace-demo';
import { buildMetadata } from '@/lib/metadata';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';
import { getSetting, SETTING_KEYS, settingDefault } from '@/lib/settings';

/** Plans, models and the compute rate are admin-editable at runtime. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  description:
    'Karo gives an AI coding agent a sandboxed Linux machine of its own — a real terminal, MCP servers, installable skills and rootless Docker — with every token and compute-second metered.',
  path: '/',
});

/** Used when the catalogue has no priced model to anchor the demo readouts. */
const NEUTRAL_PRICES: TokenPrices = {
  inputMicroUsdPerMtok: 3_000_000,
  outputMicroUsdPerMtok: 15_000_000,
  cachedInputMicroUsdPerMtok: 300_000,
  cacheWriteMicroUsdPerMtok: 3_750_000,
};

export default async function LandingPage() {
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

  const meteringPlan =
    planByKey(planCatalog.plans, 'pro') ??
    planCatalog.plans.find(isSubscriptionPlan) ??
    planCatalog.plans[0];

  return (
    <>
      <JsonLd data={faqPageJsonLd(LANDING_FAQ, '/')} />

      <Hero />

      <Section id="workspace" tone="inset" divider={false}>
        <SectionIntro
          eyebrow="The workspace"
          title="Chat, code, terminal and telemetry in one window."
          description="This is a working miniature of the Karo workspace running a scripted task: add rate limiting to a login route. Watch it type, stream, call a tool, print real terminal output and produce a diff — or click through the tabs yourself."
        />

        <div className="mt-8">
          <WorkspaceDemo
            modelName={pricingModel?.displayName ?? 'Qwen3 Coder 480B'}
            prices={prices}
          />
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
          Demo content: a scripted loop, paused with the control in the title bar and rendered
          as a single static frame when your system asks for reduced motion.
        </p>
      </Section>

      <TerminalSection />
      <SandboxSection />
      <ByosSection />
      <ModelsSection models={modelCatalog.models} />
      <McpSection />
      <SkillsSection />
      <DockerSection />

      {meteringPlan ? (
        <MeteringSection
          plan={meteringPlan}
          prices={prices}
          computeUpstreamMicroUsdPerBaseHour={computeUpstreamMicroUsdPerBaseHour}
        />
      ) : null}

      <SecuritySection />
      <UseCasesSection />
      <PricingPreview plans={planCatalog.plans} source={planCatalog.source} />
      <FaqSection />
      <FinalCta />
    </>
  );
}
