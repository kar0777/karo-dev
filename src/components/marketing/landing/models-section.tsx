import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { ModelPickerMock } from '@/components/marketing/model-picker-mock';
import type { ModelPriceView } from '@/components/marketing/plan-view';
import { Section, SectionIntro } from '@/components/marketing/section';
import { Button } from '@/components/ui/button';

/* ------------------------------------------------------------------ *
 *  Landing section 6 — model flexibility.
 *
 *  The picker is a real component fed by the live catalogue, so the
 *  multipliers it prints are the multipliers a run would be charged at.
 * ------------------------------------------------------------------ */

const POINTS = [
  {
    title: 'Pick per project, switch per message',
    body: 'A project has a default model, a conversation can override it, and a single message can too. Plan on a frontier model, apply the edits with a fast one.',
  },
  {
    title: 'Bring your own key',
    body: 'Add a provider key and those tokens are billed by your provider, not by Karo. They never draw down your included allowance, and usage shows them separately so the split is auditable.',
  },
  {
    title: 'Weighted tokens keep an allowance honest',
    body: 'One input token is one weighted token. Output, cached reads and cache writes convert at the model’s current price ratio, so an allowance holds its value when prices move or you change model mid-project.',
  },
  {
    title: 'Prices come from the catalogue, not from a slide',
    body: 'The catalogue syncs on a schedule. A model that disappears upstream is disabled rather than deleted, so a year-old usage row still explains itself.',
  },
];

export function ModelsSection({ models }: { models: readonly ModelPriceView[] }) {
  return (
    <Section id="models" tone="inset">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-6">
          <SectionIntro
            eyebrow="Model flexibility"
            title="Choose the model. Understand the bill."
            description="Karo does not lock you to one model or hide what a request cost. Every model in the catalogue is available, every price is published, and the unit your plan is measured in survives a price change."
          />

          <dl className="flex flex-col gap-4">
            {POINTS.map((point) => (
              <div key={point.title}>
                <dt className="text-[14px] font-medium text-fg">{point.title}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-muted">{point.body}</dd>
              </div>
            ))}
          </dl>

          <div>
            <Button asChild variant="outline">
              <Link href="/pricing#weighted-tokens">
                The weighted-token explainer
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <ModelPickerMock models={models} />
          <p className="text-[12.5px] leading-relaxed text-subtle">
            A working copy of the picker in the workspace. Selecting a model recomputes the
            multipliers from that model’s current price sheet — which is exactly what happens
            when a real run is settled.
          </p>
        </div>
      </div>
    </Section>
  );
}
