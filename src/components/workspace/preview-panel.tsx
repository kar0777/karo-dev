'use client';

import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';

import { SandboxBanner } from './sandbox-banner';
import { useWorkspace } from './workspace-context';

/**
 * Live preview of whatever the sandbox is serving.
 *
 * The frame is sandboxed: a dev server the agent just wrote is untrusted code,
 * and it has no business reaching Karo's own origin.
 */

const DEVICES = [
  { value: 'mobile', label: 'Mobile', icon: Smartphone, width: 390 },
  { value: 'tablet', label: 'Tablet', icon: Tablet, width: 820 },
  { value: 'desktop', label: 'Desktop', icon: Monitor, width: 0 },
] as const;

type DeviceKey = (typeof DEVICES)[number]['value'];

export function PreviewPanel() {
  const { sandbox, runInTerminal, data } = useWorkspace();

  const [device, setDevice] = React.useState<DeviceKey>('desktop');
  const [url, setUrl] = React.useState(sandbox?.previewUrl ?? '');
  const [committedUrl, setCommittedUrl] = React.useState(sandbox?.previewUrl ?? '');
  const [reloadKey, setReloadKey] = React.useState(0);

  // The sandbox is often still booting when this mounts, so its preview URL
  // arrives after the first render. Adopting it during render rather than from an
  // effect means the empty state never paints for a frame that already has a URL
  // to show. Nothing is adopted once a URL is committed, so a URL the user typed
  // in by hand is never overwritten.
  if (sandbox?.previewUrl && !committedUrl) {
    setUrl(sandbox.previewUrl);
    setCommittedUrl(sandbox.previewUrl);
  }

  const deviceWidth = DEVICES.find((entry) => entry.value === device)?.width ?? 0;

  if (!committedUrl) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="p-3">
          <SandboxBanner />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={Monitor}
            title="Nothing is being served yet"
            description="Start a dev server in the sandbox and Karo will expose its port here. For a Node project that is usually npm run dev on port 3000."
            action={
              <Button
                size="sm"
                disabled={!data.capabilities.canUseTerminal}
                onClick={() => runInTerminal('npm run dev')}
              >
                Run npm run dev
              </Button>
            }
            secondaryAction={
              <Button
                size="sm"
                variant="secondary"
                disabled={!data.capabilities.canUseTerminal}
                onClick={() => runInTerminal('python3 -m http.server 3000')}
              >
                Serve static files
              </Button>
            }
          >
            <form
              className="flex w-full max-w-md items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (url.trim()) setCommittedUrl(url.trim());
              }}
            >
              <label className="sr-only" htmlFor="preview-manual-url">
                Preview URL
              </label>
              <Input
                id="preview-manual-url"
                inputSize="sm"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!url.trim()}>
                Open
              </Button>
            </form>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            setCommittedUrl(url.trim());
            setReloadKey((key) => key + 1);
          }}
        >
          <label className="sr-only" htmlFor="preview-url">
            Preview URL
          </label>
          <Input
            id="preview-url"
            inputSize="sm"
            mono
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reload preview"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Open in a new tab" asChild>
            <a href={committedUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </form>

        <SegmentedControl<DeviceKey>
          options={DEVICES.map((entry) => ({
            value: entry.value,
            label: <entry.icon className="size-3.5" aria-hidden="true" />,
            title: entry.label,
          }))}
          value={device}
          onValueChange={setDevice}
          size="sm"
          aria-label="Preview size"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-bg-inset p-3">
        <div
          className={cn(
            'mx-auto h-full overflow-hidden rounded-md border border-line bg-surface shadow-sm',
            deviceWidth === 0 ? 'w-full' : 'w-full',
          )}
          style={deviceWidth === 0 ? undefined : { maxWidth: deviceWidth }}
        >
          <iframe
            key={`${committedUrl}-${reloadKey}`}
            src={committedUrl}
            title="Sandbox preview"
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>
  );
}
