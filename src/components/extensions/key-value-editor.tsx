'use client';

import { Eye, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type KeyValueRow = {
  /**
   * React key only — stable across re-renders so React does not remount an
   * input mid-typing. Never render it into an `id`, `htmlFor` or any other
   * attribute: it is drawn from a process-wide counter and so differs between a
   * server render and the browser. See the note in `KeyValueEditor`.
   */
  uid: string;
  key: string;
  value: string;
  secret: boolean;
  /** True when the value already exists encrypted server-side. */
  stored: boolean;
  /** True while the user is replacing a stored secret. */
  replacing: boolean;
};

let counter = 0;
export function newKeyValueRow(partial: Partial<KeyValueRow> = {}): KeyValueRow {
  counter += 1;
  return {
    uid: `kv-${counter}`,
    key: '',
    value: '',
    secret: false,
    stored: false,
    replacing: false,
    ...partial,
  };
}

export type KeyValueEditorProps = {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  /** "Variable" / "Header" — used in labels, buttons and the empty state. */
  noun: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  idPrefix: string;
  disabled?: boolean;
};

/**
 * Key/value editor with per-row secret handling.
 *
 * A stored secret is never sent to the browser, so the row renders `••••` and a
 * Replace action instead of a value. Replacing writes a new value; clearing it
 * (Replace, then Save with the field empty) removes the key server-side.
 */
export function KeyValueEditor({
  rows,
  onChange,
  noun,
  keyPlaceholder,
  valuePlaceholder,
  idPrefix,
  disabled = false,
}: KeyValueEditorProps) {
  // DOM ids are built from `useId` and the row's position, never from `row.uid`.
  // `uid` comes from a module-level counter, so its value depends on how many
  // rows the process has ever created — which is not the same number on the
  // server as in the browser. Putting it in an `id`/`htmlFor` attribute would
  // therefore be a hydration mismatch waiting for the first caller that renders
  // a populated editor during SSR. `useId` exists precisely to be stable across
  // that boundary. `uid` keeps its real job as the React key, where a mismatch
  // is harmless because keys are never serialised into the HTML.
  const fieldId = React.useId();

  function patch(uid: string, next: Partial<KeyValueRow>) {
    onChange(rows.map((row) => (row.uid === uid ? { ...row, ...next } : row)));
  }

  function remove(uid: string) {
    onChange(rows.filter((row) => row.uid !== uid));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-surface-2 px-3 py-3 text-[12px] text-muted">
          No {noun.toLowerCase()}s yet. Add one if the server needs it — Karo passes nothing
          else from its own environment.
        </p>
      ) : null}

      {rows.map((row, index) => {
        const keyId = `${idPrefix}-key-${fieldId}-${index}`;
        const valueId = `${idPrefix}-value-${fieldId}-${index}`;
        const secretId = `${idPrefix}-secret-${fieldId}-${index}`;
        const masked = row.secret && row.stored && !row.replacing;

        return (
          <div
            key={row.uid}
            className="grid grid-cols-1 gap-2 rounded-md border border-line bg-surface-2 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-start"
          >
            <div>
              <Label htmlFor={keyId} className="sr-only">
                {noun} name {index + 1}
              </Label>
              <Input
                id={keyId}
                mono
                inputSize="sm"
                value={row.key}
                placeholder={keyPlaceholder}
                disabled={disabled}
                onChange={(event) => patch(row.uid, { key: event.target.value })}
              />
            </div>

            <div>
              <Label htmlFor={valueId} className="sr-only">
                {noun} value {index + 1}
              </Label>
              {masked ? (
                <div className="flex h-7 items-center gap-2 rounded-md border border-line bg-surface px-2.5">
                  <Lock className="size-3 shrink-0 text-subtle" aria-hidden="true" />
                  <span className="karo-numeric grow font-mono text-[12px] tracking-widest text-muted">
                    ••••••••
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    disabled={disabled}
                    onClick={() => patch(row.uid, { replacing: true, value: '' })}
                  >
                    Replace
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input
                    id={valueId}
                    mono
                    inputSize="sm"
                    type={row.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={row.value}
                    placeholder={row.secret ? 'Stored encrypted' : valuePlaceholder}
                    disabled={disabled}
                    onChange={(event) => patch(row.uid, { value: event.target.value })}
                  />
                  {row.stored ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Keep the stored value"
                      aria-label="Keep the stored value"
                      disabled={disabled}
                      onClick={() => patch(row.uid, { replacing: false, value: '' })}
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id={secretId}
                  checked={row.secret}
                  disabled={disabled || row.stored}
                  onCheckedChange={(checked) =>
                    patch(row.uid, { secret: checked === true, value: '' })
                  }
                />
                <Label
                  htmlFor={secretId}
                  className={cn('text-[12px]', row.stored && 'text-subtle')}
                >
                  Secret
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={`Remove this ${noun.toLowerCase()}`}
                aria-label={`Remove ${row.key || `${noun.toLowerCase()} ${index + 1}`}`}
                disabled={disabled}
                onClick={() => remove(row.uid)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          iconLeft={<Plus />}
          disabled={disabled}
          onClick={() => onChange([...rows, newKeyValueRow()])}
        >
          Add {noun.toLowerCase()}
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
          <Eye className="size-3" aria-hidden="true" />
          Values marked secret are encrypted with AES-256-GCM and never sent back to the
          browser.
        </span>
      </div>
    </div>
  );
}
