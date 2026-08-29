'use client';

import * as React from 'react';

import { Moon, Play, RefreshCw, Server, TriangleAlert, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SANDBOX_ERROR_COPY } from '@/lib/sandbox/types';

import { useWorkspace } from './workspace-context';

/**
 * The one place that explains why the machine is not ready.
 *
 * Copy comes from `SANDBOX_ERROR_COPY` so the wording matches what the API
 * returns for the same condition, and every state offers the action that fixes
 * it rather than just naming the problem.
 */
export function SandboxBanner({ className }: { className?: string }) {
  const { sandbox, sandboxBusy, createSandbox, startSandbox, restartSandbox, data } =
    useWorkspace();
  // The transient banners are status, not mail — but a user watching a long
  // image download is allowed to hide the spinner. Per-mount state: a status
  // change brings the banner back, which is the point.
  const [dismissedTransient, setDismissedTransient] = React.useState(false);

  if (!sandbox) {
    return (
      <Alert variant="info" icon={Server} className={className}>
        <AlertTitle>No machine attached to this project</AlertTitle>
        <AlertDescription>
          <p>
            The agent can still read and discuss the code, but it needs a sandbox to run
            commands, install packages or start a dev server.
          </p>
          {data.capabilities.canCreateSandbox ? (
            <Button
              size="xs"
              variant="secondary"
              className="mt-2"
              loading={sandboxBusy}
              onClick={() => void createSandbox()}
            >
              Create a sandbox
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (sandbox.status === 'running') return null;

  if ((sandbox.status === 'starting' || sandbox.status === 'creating') && !dismissedTransient) {
    return (
      <div className={cnRelative(className)}>
        <Alert variant="primary" icon={<Spinner size="sm" label={null} />}>
          <AlertTitle>Starting {sandbox.name}…</AlertTitle>
          <AlertDescription>
            <p>
              Karo is bringing the machine up on {sandbox.provider}. Commands you send now will
              run as soon as it is ready. The MACHINE panel keeps showing progress after you
              close this.
            </p>
          </AlertDescription>
        </Alert>
        <button
          type="button"
          aria-label="Hide the progress banner"
          className="absolute top-2 right-2 rounded p-1 text-muted hover:text-fg"
          onClick={() => setDismissedTransient(true)}
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (sandbox.status === 'sleeping') {
    return (
      <Alert variant="info" icon={Moon} className={className}>
        <AlertTitle>Sandbox is asleep</AlertTitle>
        <AlertDescription>
          <p>
            It went to sleep after {sandbox.autoSleepMinutes} minutes idle to stop the compute
            meter. It wakes automatically on your next command — about four seconds.
          </p>
          <Button
            size="xs"
            variant="secondary"
            className="mt-2"
            loading={sandboxBusy}
            iconLeft={<Play />}
            onClick={startSandbox}
          >
            Wake it now
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (sandbox.status === 'failed') {
    const copy = SANDBOX_ERROR_COPY.internal;
    return (
      <Alert variant="danger" icon={TriangleAlert} className={className}>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p>{sandbox.statusMessage ?? copy.description}</p>
          <Button
            size="xs"
            variant="secondary"
            className="mt-2"
            loading={sandboxBusy}
            iconLeft={<RefreshCw />}
            onClick={restartSandbox}
          >
            Restart the machine
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const copy = SANDBOX_ERROR_COPY.not_running;
  return (
    <Alert variant="warning" icon={Server} className={className}>
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        <p>{copy.description}</p>
        <Button
          size="xs"
          variant="secondary"
          className="mt-2"
          loading={sandboxBusy}
          iconLeft={<Play />}
          onClick={startSandbox}
        >
          Start sandbox
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Keeps the caller's classes while giving the close button an anchor. */
function cnRelative(className: string | undefined): string {
  return ['relative', className].filter(Boolean).join(' ');
}
