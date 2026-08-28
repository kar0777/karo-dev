'use client';

import { KeyRound, PlugZap, Save, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { AdminPanel } from '@/components/admin/primitives';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/dot';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';

/**
 * Provider administration.
 *
 * The API key is never rendered — the panel reports only whether a credential
 * is configured and which environment variable supplies it. There is no field
 * to paste a key into on purpose: a secret that can be typed into a web form
 * ends up in browser history, proxy logs and screenshots.
 */

export type AdminProviderRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  catalogUrl: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  computeMultiplier: number;
  healthStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  modelCount: number;
  credentialConfigured: boolean;
  credentialSource: string;
  /**
   * One line from the descriptor registry answering "why would I pick this
   * one?", plus where to get a key. Shown here because the decision an operator
   * makes on this page is a cost decision, and the numbers that inform it were
   * otherwise only in the README.
   */
  summary?: string;
  signupUrl?: string | null;
};

const HEALTH_DOT: Record<string, 'live' | 'idle' | 'error' | 'pending' | 'off'> = {
  connected: 'live',
  connecting: 'pending',
  disconnected: 'off',
  error: 'error',
};

export function ProvidersPanel({ providers }: { providers: AdminProviderRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </div>
  );
}

function ProviderCard({ provider }: { provider: AdminProviderRow }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = React.useState(provider.baseUrl ?? '');
  const [catalogUrl, setCatalogUrl] = React.useState(provider.catalogUrl ?? '');
  const [multiplier, setMultiplier] = React.useState(String(provider.computeMultiplier));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; detail: string } | null>(
    null,
  );

  const dirty =
    baseUrl !== (provider.baseUrl ?? '') ||
    catalogUrl !== (provider.catalogUrl ?? '') ||
    Number(multiplier) !== provider.computeMultiplier;

  async function patch(
    body: Record<string, unknown>,
    message: string,
    busy: 'save' | 'toggle',
  ) {
    if (busy === 'save') setSaving(true);
    else setToggling(true);
    try {
      await apiFetch(`/api/admin/providers/${provider.id}`, { method: 'PATCH', json: body });
      toast.success(message, { description: provider.name });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
      setToggling(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; detail: string }>(
        `/api/admin/providers/${provider.id}`,
        { method: 'POST', json: { action: 'test' } },
      );
      setTestResult(result);
      if (result.ok) toast.success('Provider reachable', { description: result.detail });
      else toast.warning('Provider not reachable', { description: result.detail });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setTestResult({ ok: false, detail: described.message });
      toast.error(described.title, { description: described.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AdminPanel
      title={
        <span className="flex items-center gap-2">
          <StatusDot status={HEALTH_DOT[provider.healthStatus] ?? 'idle'} label={null} />
          {provider.name}
          <span className="font-mono text-[11px] font-normal text-subtle">{provider.key}</span>
          {provider.isDefault ? (
            <Badge variant="primary" size="sm">
              Default
            </Badge>
          ) : null}
        </span>
      }
      description={`${provider.modelCount} model${provider.modelCount === 1 ? '' : 's'} in the catalogue · last sync ${
        provider.lastSyncedAt ? formatRelativeTime(provider.lastSyncedAt) : 'never'
      }`}
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<PlugZap />}
            loading={testing}
            onClick={test}
          >
            Test connection
          </Button>
        </>
      }
      bodyClassName="p-4"
    >
      <div className="flex flex-col gap-4">
        {provider.summary ? (
          <p className="text-[12.5px] leading-relaxed text-muted">
            {provider.summary}
            {provider.signupUrl ? (
              <>
                {' '}
                <a
                  className="text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
                  href={provider.signupUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Get a key
                </a>
                .
              </>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <span className="flex items-center gap-2 text-[12.5px]">
            <KeyRound className="size-3.5 text-subtle" aria-hidden="true" />
            {provider.credentialConfigured ? (
              <>
                <Badge variant="success" size="sm">
                  Key configured
                </Badge>
                <span className="text-muted">
                  from{' '}
                  <code className="font-mono text-[11px]">{provider.credentialSource}</code>
                </span>
              </>
            ) : (
              <>
                <Badge variant="warning" size="sm">
                  No key
                </Badge>
                <span className="text-muted">
                  Set <code className="font-mono text-[11px]">{provider.credentialSource}</code>{' '}
                  and restart the server
                </span>
              </>
            )}
          </span>

          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-fg">
            <Switch
              aria-label={`${provider.isEnabled ? 'Disable' : 'Enable'} ${provider.name}`}
              checked={provider.isEnabled}
              disabled={toggling}
              onCheckedChange={(next) =>
                patch(
                  { isEnabled: next },
                  next ? 'Provider enabled' : 'Provider disabled',
                  'toggle',
                )
              }
            />
            Enabled
          </label>

          <label className="flex items-center gap-2 text-[12.5px] text-fg">
            <Switch
              aria-label={`Make ${provider.name} the default provider`}
              checked={provider.isDefault}
              disabled={toggling || !provider.isEnabled}
              onCheckedChange={(next) =>
                patch({ isDefault: next }, 'Default provider changed', 'toggle')
              }
            />
            Default
          </label>
        </div>

        {provider.lastSyncError ? (
          <Alert variant="danger" icon={<ShieldAlert className="size-4" />}>
            <AlertTitle>Last sync failed</AlertTitle>
            <AlertDescription>
              {provider.lastSyncError} Fix the cause and run a catalogue sync from the Models
              page.
            </AlertDescription>
          </Alert>
        ) : null}

        {testResult ? (
          <Alert variant={testResult.ok ? 'success' : 'warning'}>
            <AlertTitle>
              {testResult.ok ? 'Connection succeeded' : 'Connection failed'}
            </AlertTitle>
            <AlertDescription>{testResult.detail}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`base-${provider.id}`}>Base URL</FieldLabel>
            <Input
              id={`base-${provider.id}`}
              value={baseUrl}
              placeholder="https://api.inference.wandb.ai/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <FieldHint>
              Must be a public HTTPS endpoint — private and loopback addresses are rejected.
            </FieldHint>
          </Field>

          <Field>
            <FieldLabel htmlFor={`catalog-${provider.id}`}>Catalogue URL</FieldLabel>
            <Input
              id={`catalog-${provider.id}`}
              value={catalogUrl}
              placeholder="https://docs.wandb.ai/inference/models/"
              onChange={(event) => setCatalogUrl(event.target.value)}
            />
            <FieldHint>Where model ids and prices are refreshed from.</FieldHint>
          </Field>

          <Field>
            <FieldLabel htmlFor={`multiplier-${provider.id}`} aside="×">
              Compute multiplier
            </FieldLabel>
            <Input
              id={`multiplier-${provider.id}`}
              type="number"
              step="0.05"
              min="0.01"
              value={multiplier}
              onChange={(event) => setMultiplier(event.target.value)}
            />
            <FieldHint>
              Multiplies compute cost when this provider hosts sandboxes. 1 = the Karo baseline.
            </FieldHint>
          </Field>

          <div className="flex items-end">
            <Button
              size="sm"
              iconLeft={<Save />}
              disabled={!dirty}
              loading={saving}
              onClick={() =>
                patch(
                  {
                    baseUrl: baseUrl.trim() || null,
                    catalogUrl: catalogUrl.trim() || null,
                    computeMultiplier: Number.parseFloat(multiplier) || 1,
                  },
                  'Provider updated',
                  'save',
                )
              }
            >
              Save changes
            </Button>
          </div>
        </div>

        {provider.lastSyncedAt ? (
          <p className="text-[11px] text-subtle">
            Catalogue last refreshed {formatDateTime(provider.lastSyncedAt)}.
          </p>
        ) : null}
      </div>
    </AdminPanel>
  );
}
