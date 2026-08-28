'use client';

import { RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { AdminPanel } from '@/components/admin/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { formatRelativeTime } from '@/lib/utils';

/**
 * The platform configuration surface.
 *
 * Every row is one `admin_settings` key. The editor never guesses a type: the
 * control it renders is chosen from the row's stored `valueType`, and the value
 * it sends back is of that same kind, because `getSetting` discards a value
 * whose type does not match its fallback and silently uses the compiled default
 * instead. Booleans commit on toggle — there is no half-flipped switch worth
 * saving — while numbers and strings need an explicit save, so a stray keystroke
 * in a rate limit is not immediately platform-wide.
 */

export type SettingValueKind = 'number' | 'string' | 'boolean' | 'json';

export type AdminSettingRow = {
  key: string;
  label: string;
  description: string;
  kind: SettingValueKind;
  /** `null` for `json` rows, which are shipped content rather than a tunable. */
  value: number | string | boolean | null;
  /** What `npm run db:seed` writes for this key. */
  defaultValue: number | string | boolean | null;
  /** Human reading of the current value, e.g. `$5.00` for 5,000,000 micro-USD. */
  unitHint: string | null;
  /** The same reading for the default, so the two are comparable at a glance. */
  defaultHint: string | null;
  /** Shape of a `json` payload, so it is not an opaque blob. */
  jsonSummary: string | null;
  updatedAt: string;
  /** Email of the operator who last wrote it; `null` when only the seed has. */
  updatedBy: string | null;
  /** Modules that pass this key to `getSetting`. */
  readers: readonly string[];
};

export type AdminSettingGroup = {
  category: string;
  title: string;
  blurb: string;
  rows: readonly AdminSettingRow[];
};

export function SettingsEditor({ groups }: { groups: readonly AdminSettingGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <AdminPanel key={group.category} title={group.title} description={group.blurb}>
          <ul className="divide-y divide-line">
            {group.rows.map((row) => (
              <li key={row.key}>
                <SettingRow row={row} />
              </li>
            ))}
          </ul>
        </AdminPanel>
      ))}
    </div>
  );
}

function storedText(row: AdminSettingRow): string {
  return row.value === null ? '' : String(row.value);
}

/** Booleans read as on/off everywhere else in the console, including here. */
function defaultText(row: AdminSettingRow): string {
  if (typeof row.defaultValue === 'boolean') return row.defaultValue ? 'on' : 'off';
  if (row.defaultValue === '') return '(empty)';
  return String(row.defaultValue);
}

function SettingRow({ row }: { row: AdminSettingRow }) {
  const router = useRouter();
  const stored = storedText(row);

  const [draft, setDraft] = React.useState(stored);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A successful save re-renders this row with whatever landed in the database,
  // which may not be what was typed — the route rejects a mismatched type. The
  // draft is pulled back in line during render rather than in an effect so the
  // field never shows the rejected value beside the accepted one.
  const [seenStored, setSeenStored] = React.useState(stored);
  if (stored !== seenStored) {
    setSeenStored(stored);
    setDraft(stored);
    setError(null);
  }

  const labelId = `setting-label-${row.key}`;
  const drifted = row.defaultValue !== null && row.value !== row.defaultValue;
  const dirty = draft !== stored;

  async function commit(next: number | string | boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ summary: string }>('/api/admin/settings', {
        method: 'PATCH',
        json: { key: row.key, value: next },
      });
      toast.success('Setting saved', { description: result.summary });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (row.kind === 'number') {
      const parsed = Number(draft);
      if (draft.trim() === '' || !Number.isFinite(parsed)) {
        setError('Enter a finite number. The stored value is unchanged.');
        return;
      }
      void commit(parsed);
      return;
    }
    void commit(draft);
  }

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span id={labelId} className="text-[13px] font-medium text-fg">
            {row.label}
          </span>
          <code className="font-mono text-[11px] text-subtle">{row.key}</code>
          {drifted ? (
            <Badge variant="info" size="sm" title="The seed never overwrites an edited value">
              Changed
            </Badge>
          ) : null}
        </div>

        <p className="max-w-2xl text-[12px] leading-snug text-muted">{row.description}</p>

        {row.readers.length > 0 ? (
          <p className="text-[11px] text-subtle">
            Read by{' '}
            {row.readers.map((path, index) => (
              <React.Fragment key={path}>
                {index > 0 ? ', ' : null}
                <code className="font-mono text-[11px]">{path}</code>
              </React.Fragment>
            ))}
          </p>
        ) : null}

        {row.readers.length === 0 && row.kind !== 'json' ? (
          <p className="text-[11px] text-subtle">
            No module reads this key yet. It is documented and stored, and changing it is safe.
          </p>
        ) : null}

        <p className="text-[11px] text-subtle">
          {row.updatedBy
            ? `Last changed ${formatRelativeTime(row.updatedAt)} by ${row.updatedBy}`
            : `Written by the seed ${formatRelativeTime(row.updatedAt)}`}
        </p>
      </div>

      <div className="space-y-1.5 sm:justify-self-end">
        {row.kind === 'boolean' ? (
          <div className="flex items-center gap-2 sm:justify-end">
            <Switch
              aria-labelledby={labelId}
              checked={row.value === true}
              disabled={busy}
              onCheckedChange={(next) => void commit(next)}
            />
            <span className="text-[12.5px] text-fg">{row.value === true ? 'On' : 'Off'}</span>
          </div>
        ) : row.kind === 'json' ? (
          <Badge variant="neutral" size="sm">
            {row.jsonSummary ?? 'JSON payload'}
          </Badge>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              aria-labelledby={labelId}
              inputSize="sm"
              mono
              type={row.kind === 'number' ? 'number' : 'text'}
              value={draft}
              disabled={busy}
              className={row.kind === 'number' ? 'text-right' : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty) saveDraft();
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Save />}
              aria-label={`Save ${row.label}`}
              disabled={!dirty}
              loading={busy}
              onClick={saveDraft}
            >
              Save
            </Button>
          </div>
        )}

        {row.kind === 'json' ? (
          <FieldHint className="sm:text-right">
            Shipped content. The seed rewrites it on every run, so it is edited in the
            repository, not here.
          </FieldHint>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end">
            {row.unitHint ? (
              <span className="karo-numeric text-[11px] text-muted">{row.unitHint}</span>
            ) : null}
            {row.defaultValue !== null ? (
              <span className="text-[11px] text-subtle">
                default {defaultText(row)}
                {row.defaultHint ? ` (${row.defaultHint})` : ''}
              </span>
            ) : null}
            {drifted && row.defaultValue !== null ? (
              <Button
                size="xs"
                variant="ghost"
                iconLeft={<RotateCcw />}
                disabled={busy}
                onClick={() => {
                  if (row.defaultValue !== null) void commit(row.defaultValue);
                }}
              >
                Reset
              </Button>
            ) : null}
          </div>
        )}

        <FieldError className="sm:justify-end">{error}</FieldError>
      </div>
    </div>
  );
}
