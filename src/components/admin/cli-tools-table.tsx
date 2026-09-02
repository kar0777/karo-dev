'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';

/**
 * The catalogue admin for installable CLI agents. Every field lives in the
 * database on purpose: when a vendor changes an install command or a tool
 * needs to be pulled platform-wide, the fix is an edit here, not a deploy.
 */

export type AdminCliToolRow = {
  id: string;
  slug: string;
  name: string;
  vendor: string;
  description: string;
  license: string;
  licenseKind: 'free' | 'proprietary';
  licenseUrl: string | null;
  docsUrl: string | null;
  authKind: 'login' | 'api_key' | 'none';
  authNote: string;
  apiKeyEnvVar: string | null;
  apiKeyProviderKey: string | null;
  binName: string;
  versionArg: string;
  installCommands: { sandbox: string; macos: string; linux: string; windows: string };
  launchCommand: string;
  isEnabled: boolean;
  sortOrder: number;
};

type Draft = AdminCliToolRow & { isNew?: boolean };

const EMPTY_DRAFT: Draft = {
  id: '',
  isNew: true,
  slug: '',
  name: '',
  vendor: '',
  description: '',
  license: '',
  licenseKind: 'free',
  licenseUrl: null,
  docsUrl: null,
  authKind: 'none',
  authNote: '',
  apiKeyEnvVar: null,
  apiKeyProviderKey: null,
  binName: '',
  versionArg: '--version',
  installCommands: { sandbox: '', macos: '', linux: '', windows: '' },
  launchCommand: '',
  isEnabled: true,
  sortOrder: 100,
};

export function CliToolsTable({ tools }: { tools: AdminCliToolRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const toggle = async (tool: AdminCliToolRow, isEnabled: boolean) => {
    setTogglingId(tool.id);
    try {
      await apiFetch(`/api/admin/cli-tools/${tool.id}`, {
        method: 'PATCH',
        json: { isEnabled },
      });
      toast.success(isEnabled ? `${tool.name} enabled` : `${tool.name} disabled`);
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (tool: AdminCliToolRow) => {
    if (
      !window.confirm(`Remove ${tool.name} from the catalogue? Install state rows go with it.`)
    ) {
      return;
    }
    try {
      await apiFetch(`/api/admin/cli-tools/${tool.id}`, { method: 'DELETE' });
      toast.success(`${tool.name} removed`);
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        slug: draft.slug,
        name: draft.name,
        vendor: draft.vendor,
        description: draft.description,
        license: draft.license,
        licenseKind: draft.licenseKind,
        licenseUrl: draft.licenseUrl || null,
        docsUrl: draft.docsUrl || null,
        authKind: draft.authKind,
        authNote: draft.authNote,
        apiKeyEnvVar: draft.apiKeyEnvVar || null,
        apiKeyProviderKey: draft.apiKeyProviderKey || null,
        binName: draft.binName,
        versionArg: draft.versionArg,
        installCommands: draft.installCommands,
        launchCommand: draft.launchCommand,
        isEnabled: draft.isEnabled,
        sortOrder: draft.sortOrder,
      };
      if (draft.isNew) {
        await apiFetch('/api/admin/cli-tools', { method: 'POST', json: body });
      } else {
        const { slug: _slug, ...patch } = body;
        await apiFetch(`/api/admin/cli-tools/${draft.id}`, { method: 'PATCH', json: patch });
      }
      toast.success(draft.isNew ? `${draft.name} added` : `${draft.name} saved`);
      setDraft(null);
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <Plus aria-hidden="true" className="size-3.5" />
          Add tool
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">On</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Install (sandbox)</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool.id}>
                <TableCell>
                  <Switch
                    aria-label={`Toggle ${tool.name}`}
                    checked={tool.isEnabled}
                    disabled={togglingId === tool.id}
                    onCheckedChange={(value) => void toggle(tool, value === true)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium text-fg">{tool.name}</div>
                  <div className="text-[11.5px] text-subtle">
                    {tool.slug} · bin <code className="font-mono">{tool.binName}</code>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={tool.licenseKind === 'free' ? 'neutral' : 'warning'}
                    size="sm"
                  >
                    {tool.license || tool.licenseKind}
                  </Badge>
                </TableCell>
                <TableCell className="text-[12px] text-muted">{tool.authKind}</TableCell>
                <TableCell className="max-w-72 truncate font-mono text-[11.5px] text-subtle">
                  {tool.installCommands.sandbox}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${tool.name}`}
                      onClick={() => setDraft({ ...tool })}
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${tool.name}`}
                      onClick={() => void remove(tool)}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {tools.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-[13px] text-subtle">
                  The catalogue is empty. Run <code className="font-mono">npm run db:seed</code>{' '}
                  or add a tool by hand.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.isNew ? 'Add CLI tool' : `Edit ${draft?.name}`}</DialogTitle>
            <DialogDescription>
              Install commands are the vendor’s own official commands — Karo never mirrors or
              proxies their packages.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Slug">
                <Input
                  value={draft.slug}
                  disabled={!draft.isNew}
                  onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                />
              </Field>
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field label="Vendor">
                <Input
                  value={draft.vendor}
                  onChange={(event) => setDraft({ ...draft, vendor: event.target.value })}
                />
              </Field>
              <Field label="Binary (install check)">
                <Input
                  value={draft.binName}
                  onChange={(event) => setDraft({ ...draft, binName: event.target.value })}
                />
              </Field>
              <Field label="License label" className="col-span-1">
                <Input
                  value={draft.license}
                  onChange={(event) => setDraft({ ...draft, license: event.target.value })}
                />
              </Field>
              <Field label="License kind">
                <select
                  aria-label="License kind"
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg"
                  value={draft.licenseKind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      licenseKind: event.target.value as 'free' | 'proprietary',
                    })
                  }
                >
                  <option value="free">free</option>
                  <option value="proprietary">proprietary</option>
                </select>
              </Field>
              <Field label="Auth kind">
                <select
                  aria-label="Auth kind"
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg"
                  value={draft.authKind}
                  onChange={(event) =>
                    setDraft({ ...draft, authKind: event.target.value as Draft['authKind'] })
                  }
                >
                  <option value="login">login (interactive)</option>
                  <option value="api_key">api_key</option>
                  <option value="none">none</option>
                </select>
              </Field>
              <Field label="Key env var (for api_key)">
                <Input
                  value={draft.apiKeyEnvVar ?? ''}
                  placeholder="ANTHROPIC_API_KEY"
                  onChange={(event) => setDraft({ ...draft, apiKeyEnvVar: event.target.value })}
                />
              </Field>
              <Field label="Description" className="col-span-2">
                <Textarea
                  rows={2}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
              <Field label="Auth note" className="col-span-2">
                <Input
                  value={draft.authNote}
                  onChange={(event) => setDraft({ ...draft, authNote: event.target.value })}
                />
              </Field>
              <Field label="Install — sandbox" className="col-span-2">
                <Input
                  className="font-mono text-[12px]"
                  value={draft.installCommands.sandbox}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      installCommands: {
                        ...draft.installCommands,
                        sandbox: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Install — macOS">
                <Input
                  className="font-mono text-[12px]"
                  value={draft.installCommands.macos}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      installCommands: { ...draft.installCommands, macos: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Install — Linux">
                <Input
                  className="font-mono text-[12px]"
                  value={draft.installCommands.linux}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      installCommands: { ...draft.installCommands, linux: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Install — Windows">
                <Input
                  className="font-mono text-[12px]"
                  value={draft.installCommands.windows}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      installCommands: {
                        ...draft.installCommands,
                        windows: event.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Launch command">
                <Input
                  className="font-mono text-[12px]"
                  value={draft.launchCommand}
                  onChange={(event) =>
                    setDraft({ ...draft, launchCommand: event.target.value })
                  }
                />
              </Field>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-[12px] text-muted">{label}</Label>
      {children}
    </div>
  );
}
