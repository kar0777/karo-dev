'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Lock,
  PlugZap,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';

import type { ApiKeyView, ByokProviderOption } from '@/lib/account/api-keys';
import { CUSTOM_PROVIDER_KEY } from '@/lib/account/api-keys';
import { apiFetch, describeError } from '@/lib/client/api';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@/components/ui';

export type ApiKeysViewProps = {
  keys: ApiKeyView[];
  providers: ByokProviderOption[];
  allowByok: boolean;
  canManage: boolean;
  planName: string;
};

const VERIFICATION: Record<
  ApiKeyView['verification'],
  { label: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  verified: { label: 'Verified', variant: 'success' },
  failed: { label: 'Failed', variant: 'warning' },
  unverified: { label: 'Not tested', variant: 'neutral' },
};

export function ApiKeysView({
  keys,
  providers,
  allowByok,
  canManage,
  planName,
}: ApiKeysViewProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const disabledReason = !allowByok
    ? `Bring-your-own-key is not included in ${planName}.`
    : !canManage
      ? 'Your role cannot manage API keys.'
      : null;

  return (
    <div className="space-y-4">
      <HowByokWorks />

      {!allowByok ? (
        <Alert variant="warning" icon={<Lock />}>
          <AlertTitle>Your plan runs on Karo&apos;s provider key</AlertTitle>
          <AlertDescription>
            The {planName} plan meters every completion against your included weighted-token
            quota. Upgrade to add your own provider key — those requests then bill directly to
            your provider account and leave your Karo credits untouched.{' '}
            <Link href="/app/billing" className="font-medium text-primary hover:underline">
              Compare plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>
            Karo shows the last four characters and nothing else. The stored value is encrypted
            and can only be replaced, never read back.
          </CardDescription>
          <div className="mt-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      iconLeft={<Plus />}
                      disabled={Boolean(disabledReason)}
                      onClick={() => setAddOpen(true)}
                    >
                      Add a key
                    </Button>
                  </span>
                </TooltipTrigger>
                {disabledReason ? <TooltipContent>{disabledReason}</TooltipContent> : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>

        <CardContent className={keys.length === 0 ? undefined : 'px-0 pb-0'}>
          {keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              size="sm"
              title="No API keys yet"
              description="Add a provider key to run the agent on your own account. Nothing changes about how Karo works — only who pays the provider."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="hidden sm:table-cell">Provider</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="hidden lg:table-cell">Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <KeyRow key={key.id} apiKey={key} canManage={canManage && allowByok} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} providers={providers} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Explanation
 * ------------------------------------------------------------------ */

function HowByokWorks() {
  const points = [
    {
      icon: ShieldCheck,
      title: 'Encrypted at rest',
      body: 'The key is sealed with AES-256-GCM before it touches the database, under a server key that never leaves the host. A database dump contains ciphertext and a four-character suffix.',
    },
    {
      icon: Lock,
      title: 'Server-side only',
      body: 'It is decrypted in memory for the duration of one provider request and is never sent to a browser, written to a log, or included in an audit entry — redaction runs over everything Karo records.',
    },
    {
      icon: Wallet,
      title: 'Does not spend your Karo credits',
      body: 'Requests made on your key bill to your provider account. They are still metered so you can see token counts and latency, but they consume none of your plan’s included weighted tokens.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bring your own key</CardTitle>
        <CardDescription>
          Run the agent on your own provider account instead of Karo&apos;s.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {points.map((point) => {
          const Icon = point.icon;
          return (
            <div key={point.title} className="rounded-md border border-line bg-surface-2 p-3">
              <Icon className="size-4 text-primary" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-medium text-fg">{point.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{point.body}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Rows
 * ------------------------------------------------------------------ */

function KeyRow({ apiKey, canManage }: { apiKey: ApiKeyView; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'verify' | 'delete' | null>(null);
  const [replaceOpen, setReplaceOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  async function verify() {
    setBusy('verify');
    try {
      const result = await apiFetch<{ ok: boolean; detail: string }>(
        `/api/api-keys/${apiKey.id}/verify`,
        { method: 'POST' },
      );
      if (result.ok) toast.success('Connection works', { description: result.detail });
      else toast.error('The provider rejected this key', { description: result.detail });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await apiFetch(`/api/api-keys/${apiKey.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      toast.success(`${apiKey.label} deleted`, {
        description: 'Runs fall back to Karo’s provider credentials.',
      });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  const status = VERIFICATION[apiKey.verification];

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-fg">{apiKey.label}</div>
        <div className="text-[11px] text-subtle sm:hidden">{apiKey.providerName}</div>
        {apiKey.baseUrl ? (
          <div className="max-w-[16rem] truncate font-mono text-[11px] text-subtle">
            {apiKey.baseUrl}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-muted sm:table-cell">{apiKey.providerName}</TableCell>
      <TableCell>
        <code className="karo-numeric font-mono text-[12px] text-muted">
          {apiKey.maskedKey}
        </code>
        <div className="text-[11px] text-subtle" title={formatDateTime(apiKey.createdAt)}>
          Added {formatRelativeTime(apiKey.createdAt)}
        </div>
      </TableCell>
      <TableCell className="hidden text-muted lg:table-cell">
        {apiKey.lastUsedAt ? formatRelativeTime(apiKey.lastUsedAt) : 'Never'}
      </TableCell>
      <TableCell>
        <Badge size="sm" variant={status.variant}>
          {status.label}
        </Badge>
        {apiKey.verification === 'failed' && apiKey.lastVerifyError ? (
          <p className="mt-1 max-w-[18rem] text-[11px] leading-relaxed text-danger">
            {apiKey.lastVerifyError}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<PlugZap />}
            loading={busy === 'verify'}
            disabled={!canManage || busy !== null}
            onClick={verify}
          >
            Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<RefreshCcw />}
            disabled={!canManage || busy !== null}
            onClick={() => setReplaceOpen(true)}
          >
            Replace
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${apiKey.label}`}
            className="text-danger hover:bg-danger-soft hover:text-danger"
            disabled={!canManage || busy !== null}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </Button>
        </div>

        <ReplaceKeyDialog apiKey={apiKey} open={replaceOpen} onOpenChange={setReplaceOpen} />

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {apiKey.label}?</DialogTitle>
              <DialogDescription>
                Runs that were using this key immediately fall back to Karo&apos;s provider
                credentials and start consuming your included quota again. Nothing is charged to
                your provider account after this.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                Keep it
              </Button>
              <Button variant="danger" loading={busy === 'delete'} onClick={remove}>
                Delete key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ *
 *  Add / replace
 * ------------------------------------------------------------------ */

function AddKeyDialog({
  open,
  onOpenChange,
  providers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ByokProviderOption[];
}) {
  const router = useRouter();
  const first = providers[0];
  const [label, setLabel] = React.useState('');
  const [providerKey, setProviderKey] = React.useState(first?.key ?? CUSTOM_PROVIDER_KEY);
  const [baseUrl, setBaseUrl] = React.useState(first?.defaultBaseUrl ?? '');
  const [secret, setSecret] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Every open starts from a blank form. The reset is adjusted during render
  // rather than from an effect so the reopened dialog never paints a frame of
  // the previous attempt — which for `secret` would mean briefly showing a key
  // the user already submitted or abandoned.
  const [seenOpen, setSeenOpen] = React.useState(open);
  const [seenFirst, setSeenFirst] = React.useState(first);
  if (open !== seenOpen || first !== seenFirst) {
    setSeenOpen(open);
    setSeenFirst(first);
    // Closing deliberately leaves the fields as they are: the dialog is still
    // animating out and wiping them mid-fade would be visible.
    if (open) {
      setLabel('');
      setProviderKey(first?.key ?? CUSTOM_PROVIDER_KEY);
      setBaseUrl(first?.defaultBaseUrl ?? '');
      setSecret('');
      setError(null);
    }
  }

  const selected = providers.find((provider) => provider.key === providerKey);

  function handleProviderChange(next: string) {
    setProviderKey(next);
    const option = providers.find((provider) => provider.key === next);
    setBaseUrl(option?.defaultBaseUrl ?? '');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (!label.trim()) {
      setError('Give the key a label you will recognise later.');
      return;
    }
    if (secret.trim().length < 8) {
      setError('Paste the full key — this one looks truncated.');
      return;
    }
    if (selected?.requiresBaseUrl && !baseUrl.trim()) {
      setError('A custom endpoint needs its base URL, for example https://api.example.com/v1');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await apiFetch('/api/api-keys', {
        method: 'POST',
        json: {
          label: label.trim(),
          providerKey,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: secret.trim(),
        },
      });
      // Cleared before the dialog animates out so the secret is not left in
      // React state a moment longer than it has to be.
      setSecret('');
      onOpenChange(false);
      toast.success('API key saved', {
        description: 'Test the connection to confirm the provider accepts it.',
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add a provider key</DialogTitle>
            <DialogDescription>
              Karo encrypts the value on arrival and never shows it again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Field>
              <FieldLabel htmlFor="key-label" required>
                Label
              </FieldLabel>
              <Input
                id="key-label"
                value={label}
                maxLength={60}
                autoFocus
                placeholder="Personal W&B key"
                onChange={(event) => setLabel(event.target.value)}
              />
              <FieldHint>Only for you — it appears in this list and nowhere else.</FieldHint>
            </Field>

            <Field>
              <FieldLabel htmlFor="key-provider" required>
                Provider
              </FieldLabel>
              <Select value={providerKey} onValueChange={handleProviderChange}>
                <SelectTrigger id="key-provider" className="w-full">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.key} value={provider.key}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? <FieldHint>{selected.hint}</FieldHint> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="key-base-url" required={selected?.requiresBaseUrl}>
                Base URL
              </FieldLabel>
              <Input
                id="key-base-url"
                value={baseUrl}
                mono
                inputMode="url"
                placeholder="https://api.example.com/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <FieldHint>
                {selected?.requiresBaseUrl
                  ? 'The OpenAI-compatible root your provider documents.'
                  : 'Leave as-is unless your provider gave you a different endpoint.'}
              </FieldHint>
            </Field>

            <Field>
              <FieldLabel htmlFor="key-secret" required>
                API key
              </FieldLabel>
              <Input
                id="key-secret"
                type="password"
                value={secret}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-..."
                onChange={(event) => setSecret(event.target.value)}
              />
              <FieldHint>
                Pasted once. After saving, only the last four characters are ever shown.
              </FieldHint>
            </Field>

            {error ? <FieldError>{error}</FieldError> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceKeyDialog({
  apiKey,
  open,
  onOpenChange,
}: {
  apiKey: ApiKeyView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [secret, setSecret] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Adjusted during render rather than from an effect so a value typed into a
  // previous open is out of state before the reopened dialog paints.
  const [seenOpen, setSeenOpen] = React.useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    // Only on the way in — clearing while the dialog animates closed would be
    // visible to the user.
    if (open) {
      setSecret('');
      setError(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (secret.trim().length < 8) {
      setError('Paste the full replacement key.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await apiFetch(`/api/api-keys/${apiKey.id}`, {
        method: 'PATCH',
        json: { apiKey: secret.trim() },
      });
      setSecret('');
      onOpenChange(false);
      toast.success(`${apiKey.label} replaced`, {
        description: 'Test the connection to confirm the new value works.',
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Replace {apiKey.label}</DialogTitle>
            <DialogDescription>
              The old value is overwritten immediately. Runs already in flight finish on the key
              they started with.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field>
              <FieldLabel htmlFor={`replace-${apiKey.id}`} required>
                New API key
              </FieldLabel>
              <Input
                id={`replace-${apiKey.id}`}
                type="password"
                value={secret}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-..."
                onChange={(event) => setSecret(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldHint>
                  Currently ending in <span className="font-mono">{apiKey.keyLast4}</span>.
                </FieldHint>
              )}
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Replace key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
