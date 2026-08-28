'use client';

import * as React from 'react';

import {
  McpServerFields,
  mcpFormFromServer,
  mcpFormToBody,
  type McpFormValue,
} from '@/components/extensions/mcp-server-fields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { McpServerView, ProjectOptionView } from '@/lib/extensions/types';

export type McpEditDialogProps = {
  /** `null` closes the dialog — the row being edited is the open state. */
  server: McpServerView | null;
  projects: readonly ProjectOptionView[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function McpEditDialog({ server, projects, onOpenChange, onSaved }: McpEditDialogProps) {
  const [value, setValue] = React.useState<McpFormValue | null>(() =>
    server ? mcpFormFromServer(server) : null,
  );
  const [busy, setBusy] = React.useState(false);

  // The form is a snapshot of the row being edited, so it is re-derived during
  // render rather than from an effect. React throws away the in-progress render
  // and retries with the new draft, so the fields never paint the previous
  // row's values for a frame on the way in.
  const [editing, setEditing] = React.useState(server);
  if (server !== editing) {
    setEditing(server);
    setValue(server ? mcpFormFromServer(server) : null);
  }

  async function save() {
    if (!server || !value) return;
    setBusy(true);
    try {
      await apiFetch(`/api/mcp/${server.id}`, { method: 'PATCH', json: mcpFormToBody(value) });
      toast.success(`${value.name.trim() || server.name} saved`, {
        description:
          'The live connection was dropped so the next run picks up the new settings.',
      });
      onOpenChange(false);
      onSaved();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={server !== null}
      onOpenChange={busy ? undefined : (open) => onOpenChange(open)}
    >
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-line px-5 pt-5 pb-4">
          <DialogTitle>Edit {server?.name ?? 'server'}</DialogTitle>
          <DialogDescription>
            Stored secrets stay encrypted and are never shown. Use Replace to overwrite one, or
            clear the field to delete it.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[58vh]">
          <div className="px-5 py-4">
            {value ? (
              <McpServerFields
                value={value}
                onChange={setValue}
                projects={projects}
                idPrefix={`mcp-edit-${server?.id ?? 'x'}`}
                disabled={busy}
              />
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-line px-5 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            loading={busy}
            disabled={!value || value.name.trim() === ''}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
