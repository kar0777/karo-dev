'use client';

import * as React from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';

import { apiFetch, describeError } from '@/lib/client/api';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  toast,
} from '@/components/ui';

export type DangerZoneProps = {
  email: string;
  /** Teams the user owns, split by whether anyone else is in them. */
  ownedSoloTeams: string[];
  ownedSharedTeams: string[];
  /** Counts shown so "everything" is not an abstraction. */
  removed: {
    projects: number;
    sandboxes: number;
    conversations: number;
    apiKeys: number;
    servers: number;
  };
  isDemo: boolean;
};

export function DangerZone({
  email,
  ownedSoloTeams,
  ownedSharedTeams,
  removed,
  isDemo,
}: DangerZoneProps) {
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const blocked = ownedSharedTeams.length > 0 || isDemo;
  const matches = confirmation.trim().toLowerCase() === email.toLowerCase();

  async function confirm() {
    if (busy || !matches) return;
    setBusy(true);
    setError(null);

    try {
      await apiFetch('/api/settings/account', {
        method: 'DELETE',
        json: { confirmation: confirmation.trim() },
      });
      toast.success('Account deleted');
      window.location.assign('/');
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      setBusy(false);
    }
  }

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="text-danger">Delete this account</CardTitle>
        <CardDescription>
          Permanent and immediate. There is no export, no grace period and no undo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <p className="text-[13px] font-medium text-fg">What gets deleted</p>
          <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted">
            <li>
              · <span className="karo-numeric text-fg">{removed.projects}</span> project
              {removed.projects === 1 ? '' : 's'} and every file in them
            </li>
            <li>
              · <span className="karo-numeric text-fg">{removed.conversations}</span>{' '}
              conversation
              {removed.conversations === 1 ? '' : 's'}, with their agent runs and tool history
            </li>
            <li>
              · <span className="karo-numeric text-fg">{removed.sandboxes}</span> sandbox
              {removed.sandboxes === 1 ? '' : 'es'} — destroyed, not stopped
            </li>
            <li>
              · <span className="karo-numeric text-fg">{removed.apiKeys}</span> stored API key
              {removed.apiKeys === 1 ? '' : 's'} and{' '}
              <span className="karo-numeric text-fg">{removed.servers}</span> registered server
              {removed.servers === 1 ? '' : 's'}
            </li>
            <li>· Your sessions, notifications and personal preferences</li>
            {ownedSoloTeams.length > 0 ? (
              <li>
                · The workspace{ownedSoloTeams.length === 1 ? '' : 's'} you own:{' '}
                <span className="text-fg">{ownedSoloTeams.join(', ')}</span>
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          <p className="text-[13px] font-medium text-fg">What is kept</p>
          <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted">
            <li>
              · Billing records and invoices, which Karo is required to retain for accounting
            </li>
            <li>
              · Audit entries, with your account reference removed — the events stay, the
              identity does not
            </li>
            <li>
              · Work you created in teams you do not own, transferred to that team&apos;s owner
              so their projects keep running
            </li>
          </ul>
        </div>

        {isDemo ? (
          <Alert variant="info">
            <AlertTitle>The demo account is protected</AlertTitle>
            <AlertDescription>
              This is the shared account everyone signs into. Register your own account if you
              want one you can delete.
            </AlertDescription>
          </Alert>
        ) : null}

        {ownedSharedTeams.length > 0 ? (
          <Alert variant="warning" icon={<TriangleAlert />}>
            <AlertTitle>Hand over your shared teams first</AlertTitle>
            <AlertDescription>
              You own {ownedSharedTeams.join(', ')}, which{' '}
              {ownedSharedTeams.length === 1 ? 'has' : 'have'} other members. Deleting your
              account would delete {ownedSharedTeams.length === 1 ? 'that team' : 'those teams'}{' '}
              and everything in {ownedSharedTeams.length === 1 ? 'it' : 'them'}. Remove the
              other members, or ask a platform administrator to transfer ownership.
            </AlertDescription>
          </Alert>
        ) : null}

        <Button
          variant="danger"
          iconLeft={<Trash2 />}
          disabled={blocked}
          onClick={() => {
            setConfirmation('');
            setError(null);
            setOpen(true);
          }}
        >
          Delete account
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account permanently?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Every project, sandbox and conversation listed above is
              removed immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field>
              <FieldLabel htmlFor="delete-confirmation" required>
                Type <span className="font-mono text-fg">{email}</span> to confirm
              </FieldLabel>
              <Input
                id="delete-confirmation"
                value={confirmation}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldHint>
                  Typed by hand on purpose — this is the last step before deletion.
                </FieldHint>
              )}
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button variant="danger" loading={busy} disabled={!matches} onClick={confirm}>
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
