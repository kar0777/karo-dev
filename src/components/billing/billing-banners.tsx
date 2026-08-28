'use client';

import { CheckCircle2, FlaskConical, X } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';

/**
 * Two banners that answer the two questions people have on this page:
 * "did my payment go through?" and "is this real money?".
 */

export type CheckoutOutcome =
  | { kind: 'subscription'; simulated: boolean }
  | { kind: 'topup'; simulated: boolean }
  | { kind: 'generic'; simulated: boolean }
  | { kind: 'cancelled' }
  | { kind: 'portal' };

export function CheckoutReturnBanner({ outcome }: { outcome: CheckoutOutcome }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;

  const content = describeOutcome(outcome);

  return (
    <Alert
      variant={content.variant}
      icon={content.variant === 'success' ? CheckCircle2 : undefined}
      role="status"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <AlertTitle>{content.title}</AlertTitle>
          <AlertDescription>{content.body}</AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss this message"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </Alert>
  );
}

function describeOutcome(outcome: CheckoutOutcome): {
  variant: 'success' | 'info' | 'warning';
  title: string;
  body: string;
} {
  switch (outcome.kind) {
    case 'subscription':
      return {
        variant: 'success',
        title: 'Subscription active',
        body: outcome.simulated
          ? 'Simulated checkout completed instantly and your new allowance is already available. No card was charged.'
          : 'Your plan is active and the new allowance is available right away. A receipt is in Payment history below.',
      };
    case 'topup':
      return {
        variant: 'success',
        title: 'Credit added',
        body: outcome.simulated
          ? 'Simulated payment completed instantly and your balance was credited. No card was charged.'
          : 'Your balance has been credited. The receipt appears in Payment history within a few seconds.',
      };
    case 'generic':
      return {
        variant: 'success',
        title: 'Payment completed',
        body: outcome.simulated
          ? 'Simulated checkout completed. Your balance and plan below are already up to date; no card was charged.'
          : 'Your balance and plan below are up to date.',
      };
    case 'cancelled':
      return {
        variant: 'info',
        title: 'Checkout cancelled',
        body: 'Nothing was charged and nothing changed. Pick a plan or an amount again whenever you are ready.',
      };
    case 'portal':
    default:
      return {
        variant: 'info',
        title: 'There is no external billing portal in simulated mode',
        body: 'Payment methods and tax details live with the payment provider. Configure Stripe to open the real portal — everything else on this page already works.',
      };
  }
}

/**
 * Simulated-billing notice. Calm on purpose: this is the default state of a
 * fresh install, not a fault, and it must not read like a broken deployment.
 */
export function SimulatedBillingBanner() {
  const [open, setOpen] = React.useState(false);

  return (
    <Alert variant="info" icon={FlaskConical}>
      <div className="flex w-full flex-col gap-2">
        <div>
          <AlertTitle>Billing is simulated</AlertTitle>
          <AlertDescription>
            Checkout completes instantly, balances and invoices are real database rows, and no
            card is ever charged. Every flow on this page behaves exactly as it will in
            production.
          </AlertDescription>
        </div>

        <div>
          <Button
            variant="link"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="simulated-billing-details"
          >
            {open ? 'Hide setup' : 'How do I enable real payments?'}
          </Button>
        </div>

        {open ? (
          <div id="simulated-billing-details" className="flex flex-col gap-2">
            <p className="text-[12px] leading-relaxed text-muted">
              Set <code className="font-mono">STRIPE_SECRET_KEY</code> and restart. Karo
              switches to Stripe automatically — there is no second flag. Add{' '}
              <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> so the webhook endpoint
              can verify signatures, and set each plan&rsquo;s price ids in Admin → Plans.
            </p>
            <CodeBlock
              language="bash"
              filename=".env.local"
              code={`STRIPE_SECRET_KEY=sk_live_...\nSTRIPE_WEBHOOK_SECRET=whsec_...`}
            />
          </div>
        ) : null}
      </div>
    </Alert>
  );
}
