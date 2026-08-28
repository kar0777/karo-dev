'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { isSafeWorkspacePath } from '@/lib/agent/policy';

import { useWorkspace } from './workspace-context';

/**
 * Create / rename / delete, shared by the tree rows and the explorer footer so
 * both paths validate identically against `normalizeWorkspacePath` rules.
 */

export type FileAction =
  | { kind: 'new-file'; parent: string }
  | { kind: 'new-folder'; parent: string }
  | { kind: 'rename'; path: string }
  | { kind: 'delete'; path: string };

const TITLES: Record<FileAction['kind'], string> = {
  'new-file': 'New file',
  'new-folder': 'New folder',
  rename: 'Rename file',
  delete: 'Delete file',
};

const DESCRIPTIONS: Record<FileAction['kind'], string> = {
  'new-file': 'Paths are relative to /workspace.',
  'new-folder': 'Karo tracks files, so a new folder gets an empty .gitkeep to hold its place.',
  rename: 'The file keeps its contents; only the path changes.',
  delete: 'This removes the file from the project workspace. The agent will no longer see it.',
};

/** A rename starts from the current basename; everything else starts empty. */
function draftFor(action: FileAction | null): string {
  return action?.kind === 'rename' ? (action.path.split('/').pop() ?? '') : '';
}

export function FileActionDialog({
  action,
  onClose,
}: {
  action: FileAction | null;
  onClose: () => void;
}) {
  const { createFile, createFolder, renameFile, deleteFile } = useWorkspace();

  const [draft, setDraft] = React.useState(() => draftFor(action));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // The draft is seeded from the action being confirmed, and adjusting it during
  // render rather than in an effect means the autofocused input already holds
  // the right name on the first paint. Closing (`action` back to null) leaves
  // the draft alone so the fields do not empty out under the exit animation.
  const [seenAction, setSeenAction] = React.useState(action);
  if (action !== seenAction) {
    setSeenAction(action);
    if (action) {
      setError(null);
      setDraft(draftFor(action));
    }
  }

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'delete') {
        await deleteFile(action.path);
      } else if (action.kind === 'rename') {
        const name = draft.trim();
        if (!name) {
          setError('Give it a name first.');
          return;
        }
        const slash = action.path.lastIndexOf('/');
        const target = slash === -1 ? name : `${action.path.slice(0, slash)}/${name}`;
        if (!isSafeWorkspacePath(target)) {
          setError(
            'That name leaves the workspace. Use a plain name, without ".." or a leading "/".',
          );
          return;
        }
        await renameFile(action.path, target);
      } else {
        const name = draft.trim();
        if (!name) {
          setError('Give it a name first.');
          return;
        }
        const target = action.parent ? `${action.parent}/${name}` : name;
        if (!isSafeWorkspacePath(target)) {
          setError(
            'That path leaves the workspace. Use a plain name, without ".." or a leading "/".',
          );
          return;
        }
        if (action.kind === 'new-file') await createFile(target);
        else await createFolder(target);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={action !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{action ? TITLES[action.kind] : 'File'}</DialogTitle>
          <DialogDescription>{action ? DESCRIPTIONS[action.kind] : ''}</DialogDescription>
        </DialogHeader>

        {action && action.kind !== 'delete' ? (
          <Field>
            <FieldLabel htmlFor="karo-file-name">
              {action.kind === 'rename' ? 'New name' : 'Name'}
            </FieldLabel>
            <Input
              id="karo-file-name"
              autoFocus
              mono
              value={draft}
              placeholder={action.kind === 'new-folder' ? 'components' : 'index.ts'}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void confirm();
              }}
            />
            {action.kind !== 'rename' && action.parent ? (
              <p className="text-[11.5px] text-subtle">
                Inside <code className="font-mono">{action.parent}/</code>
              </p>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        ) : action ? (
          <div>
            <code className="font-mono text-[12.5px] break-all text-fg">{action.path}</code>
            {error ? <FieldError className="mt-2">{error}</FieldError> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={action?.kind === 'delete' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void confirm()}
          >
            {action?.kind === 'delete'
              ? 'Delete'
              : action?.kind === 'rename'
                ? 'Rename'
                : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
