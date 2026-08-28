'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatMicroUsd } from '@/lib/utils';

import { useWorkspace } from './workspace-context';

/**
 * The expensive-run prompt.
 *
 * The server refuses to start a run whose forecast crosses the threshold an
 * admin set, and sends the forecast back instead. Nothing has been created and
 * nothing has been charged at the point this opens, so dismissing it — by
 * Escape, by the overlay, by "Not now" — costs the user nothing.
 *
 * The estimate is shown precisely rather than rounded: the whole point of the
 * prompt is that the reader is deciding on the number.
 */

const CONFIDENCE_COPY: Record<'low' | 'medium' | 'high', { label: string; hint: string }> = {
  high: {
    label: 'Narrow range',
    hint: 'Short runs land close to their forecast.',
  },
  medium: {
    label: 'Rough',
    hint: 'The agent may stop early, in which case you pay less.',
  },
  low: {
    label: 'Wide range',
    hint: 'Long tool-using runs vary a lot, and one that reads large files or long command output can finish well above this.',
  },
};

export function CostConfirmDialog() {
  const { pendingCostConfirmation, confirmPendingCost, cancelPendingCost } = useWorkspace();
  const pending = pendingCostConfirmation;

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) cancelPendingCost();
      }}
    >
      <DialogContent>
        {pending ? (
          <>
            <DialogHeader>
              <DialogTitle>This run looks expensive</DialogTitle>
              <DialogDescription>
                It is forecast above the {formatMicroUsd(pending.thresholdMicroUsd)} limit set
                for this workspace, so nothing has started and nothing has been charged yet.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                Estimated cost
              </p>
              <p className="karo-numeric mt-0.5 flex items-baseline gap-2 text-[22px] font-semibold text-fg">
                {formatMicroUsd(pending.estimatedMicroUsd, { precise: true })}
                <Badge variant={pending.confidence === 'low' ? 'warning' : 'neutral'} size="sm">
                  {CONFIDENCE_COPY[pending.confidence].label}
                </Badge>
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {pending.explanation}
              </p>
            </div>

            <p className="text-[12px] leading-relaxed text-muted">
              {CONFIDENCE_COPY[pending.confidence].hint} You can stop the run at any point and
              only pay for the steps that finished.
            </p>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={cancelPendingCost}>
                Not now
              </Button>
              <Button size="sm" onClick={confirmPendingCost}>
                Run it — about {formatMicroUsd(pending.estimatedMicroUsd)}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
