'use client';

import { FlaskConical } from 'lucide-react';

import { useOptionalSession } from '@/components/app/session-provider';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The demo-mode indicator.
 *
 * It is not decoration. A user in demo mode will see the agent "run" commands
 * and "charge" money, so the badge has to say exactly which providers are
 * simulated and what to set to make each one real — otherwise the first
 * surprise is a support ticket.
 */

type SimulatedKey = 'ai' | 'sandbox' | 'billing';

const PROVIDER_NOTES: Record<
  SimulatedKey,
  { label: string; simulated: string; enable: string }
> = {
  ai: {
    label: 'Model provider',
    simulated: 'Replies, tool calls and token counts are generated locally.',
    enable: 'Set WANDB_API_KEY (cheapest to start), or add your own key under API keys.',
  },
  sandbox: {
    label: 'Sandbox',
    simulated: 'The filesystem and shell are emulated in Karo — no Linux machine is running.',
    enable: 'Set DOCKER_SOCKET for local containers, or DAYTONA_API_KEY for hosted sandboxes.',
  },
  billing: {
    label: 'Billing',
    simulated: 'Checkout and top-ups complete instantly and no card is charged.',
    enable: 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.',
  },
};

export type DemoModeBadgeProps = {
  className?: string;
  /** `compact` is the top-bar chip; `full` adds the word "mode" for wider rows. */
  variant?: 'compact' | 'full';
};

export function DemoModeBadge({ className, variant = 'compact' }: DemoModeBadgeProps) {
  const session = useOptionalSession();
  if (!session?.demoMode) return null;

  const simulated = (Object.keys(PROVIDER_NOTES) as SimulatedKey[]).filter(
    (key) => session.simulated[key],
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="warning"
          size="sm"
          className={cn('cursor-help gap-1', className)}
          tabIndex={0}
          role="button"
          aria-label="Demo mode — see which providers are simulated"
        >
          <FlaskConical className="size-3" aria-hidden="true" />
          {variant === 'full' ? 'Demo mode' : 'Demo'}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-80 p-2.5">
        <p className="text-[12px] font-medium text-fg">
          {simulated.length === 0
            ? 'Demo mode is forced on.'
            : `${simulated.length} of 3 providers are simulated.`}
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {(Object.keys(PROVIDER_NOTES) as SimulatedKey[]).map((key) => {
            const note = PROVIDER_NOTES[key];
            const isSimulated = session.simulated[key];
            return (
              <li key={key} className="leading-snug">
                <span className="font-medium text-fg">{note.label}</span>{' '}
                <span className={isSimulated ? 'text-warning-soft-fg' : 'text-primary'}>
                  {isSimulated ? 'simulated' : 'live'}
                </span>
                <br />
                <span className="text-muted">
                  {isSimulated ? note.simulated : 'Using real credentials.'}
                </span>
                {isSimulated ? (
                  <>
                    <br />
                    <span className="font-mono text-[10.5px] text-subtle">{note.enable}</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 border-t border-line pt-1.5 text-[11px] text-subtle">
          Everything else — quotas, weighted tokens, audit, RBAC — behaves exactly as it does in
          production.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
