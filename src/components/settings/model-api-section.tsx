import Link from 'next/link';
import { ArrowRight, CircleCheck, CircleSlash, KeyRound } from 'lucide-react';

import type { ApiKeyVerification } from '@/lib/account/api-keys';
import type { PlanTier } from '@/lib/db/schema';
import { formatCompactNumber } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * "Which model is my money going through, and on whose key?"
 *
 * Deliberately a Server Component: it is a read-only answer assembled from the
 * catalogue and the plan, and shipping a client bundle for a table nobody
 * interacts with would be waste.
 */

export type ModelAvailability = {
  id: string;
  name: string;
  providerName: string;
  family: string;
  contextWindow: number;
  minPlanTier: PlanTier;
  requiredPlanLabel: string;
  available: boolean;
  isDefault: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
};

export type ModelApiSectionProps = {
  demoMode: boolean;
  activeProvider: { key: string; name: string; configured: boolean };
  byok: Array<{
    id: string;
    label: string;
    providerName: string;
    maskedKey: string;
    verification: ApiKeyVerification;
    isActive: boolean;
  }>;
  models: ModelAvailability[];
  planName: string;
  allowByok: boolean;
};

const VERIFICATION_BADGE: Record<
  ApiKeyVerification,
  { label: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  verified: { label: 'Verified', variant: 'success' },
  failed: { label: 'Last test failed', variant: 'warning' },
  unverified: { label: 'Not tested', variant: 'neutral' },
};

export function ModelApiSection({
  demoMode,
  activeProvider,
  byok,
  models,
  planName,
  allowByok,
}: ModelApiSectionProps) {
  const activeByok = byok.filter((key) => key.isActive);
  const runningOnOwnKey = activeByok.length > 0;
  const availableCount = models.filter((model) => model.available).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Model provider</CardTitle>
          <CardDescription>
            Where completions are sent, and which credentials pay for them.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {demoMode ? (
            <Alert variant="info">
              <AlertTitle>Running in demo mode</AlertTitle>
              <AlertDescription>
                No provider credentials are configured, so every completion is produced by
                Karo&apos;s built-in simulator. Prices, token counts and quota all behave
                exactly as they would against a real provider — nothing is charged and nothing
                leaves this server.
              </AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-[11px] tracking-wide text-subtle uppercase">
                Active provider
              </dt>
              <dd className="mt-1 text-[13px] font-medium text-fg">{activeProvider.name}</dd>
              <dd className="mt-0.5 font-mono text-[11px] text-subtle">{activeProvider.key}</dd>
            </div>

            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-[11px] tracking-wide text-subtle uppercase">Credentials</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-fg">
                {runningOnOwnKey ? (
                  <>
                    <CircleCheck className="size-3.5 text-primary" aria-hidden="true" />
                    Your own key
                  </>
                ) : (
                  <>
                    <KeyRound className="size-3.5 text-ember" aria-hidden="true" />
                    Karo&apos;s key
                  </>
                )}
              </dd>
              <dd className="mt-0.5 text-[11px] text-subtle">
                {runningOnOwnKey
                  ? 'BYOK requests do not consume included credits.'
                  : 'Usage is metered against your plan quota.'}
              </dd>
            </div>

            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-[11px] tracking-wide text-subtle uppercase">
                Models on {planName}
              </dt>
              <dd className="karo-numeric mt-1 text-[13px] font-medium text-fg">
                {availableCount} of {models.length}
              </dd>
              <dd className="mt-0.5 text-[11px] text-subtle">
                Higher tiers unlock the larger frontier models.
              </dd>
            </div>
          </dl>

          {activeByok.length > 0 ? (
            <ul className="space-y-1.5">
              {activeByok.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {key.label}
                    </span>
                    <span className="text-[12px] text-subtle">{key.providerName}</span>
                    <code className="karo-numeric font-mono text-[12px] text-muted">
                      {key.maskedKey}
                    </code>
                  </span>
                  <Badge size="sm" variant={VERIFICATION_BADGE[key.verification].variant}>
                    {VERIFICATION_BADGE[key.verification].label}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" asChild iconRight={<ArrowRight />}>
              <Link href="/app/api-keys">
                {runningOnOwnKey ? 'Manage API keys' : 'Use your own API key'}
              </Link>
            </Button>
            {!allowByok ? (
              <span className="text-[12px] text-subtle">
                Bring-your-own-key is not included in {planName}.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model availability</CardTitle>
          <CardDescription>
            Every model in the catalogue and whether the {planName} plan can select it. Pricing
            and usage live in Billing.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="hidden sm:table-cell">Provider</TableHead>
                <TableHead className="hidden md:table-cell">Context</TableHead>
                <TableHead className="text-right">Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-fg">{model.name}</span>
                      {model.isDefault ? (
                        <Badge size="sm" variant="primary">
                          Default
                        </Badge>
                      ) : null}
                      {model.supportsVision ? (
                        <Badge size="sm" variant="outline">
                          Vision
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-subtle sm:hidden">
                      {model.providerName}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted sm:table-cell">
                    {model.providerName}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-muted md:table-cell">
                    {formatCompactNumber(model.contextWindow, 0)} tokens
                  </TableCell>
                  <TableCell className="text-right">
                    {model.available ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-success">
                        <CircleCheck className="size-3.5" aria-hidden="true" />
                        Included
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] text-subtle">
                        <CircleSlash className="size-3.5" aria-hidden="true" />
                        Needs {model.requiredPlanLabel}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
