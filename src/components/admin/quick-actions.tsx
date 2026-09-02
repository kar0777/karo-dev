'use client';

import { Gauge, MoonStar, RefreshCcwDot } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';

/**
 * Operator quick actions for the admin overview.
 *
 * The maintenance jobs are idempotent and safe to run on demand — they are
 * the same code the cron tick runs — so an operator chasing an oddity
 * ("why is that sandbox still awake?") should not need curl or a redeploy.
 */

type Job = {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => Promise<string>;
};

export function QuickActions() {
  const router = useRouter();
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const jobs: Job[] = [
    {
      key: 'tick',
      label: 'Run maintenance tick',
      description: 'Idle sandboxes, balances, pending plan changes',
      icon: Gauge,
      run: async () => {
        const result = await apiFetch<{ summary?: string; ok?: boolean }>('/api/cron/tick', {
          json: {},
        });
        return (
          result.summary ?? (result.ok ? 'Tick complete.' : 'Tick finished with warnings.')
        );
      },
    },
    {
      key: 'sweep',
      label: 'Sleep idle sandboxes',
      description: 'Sweep the fleet for machines past their idle limit',
      icon: MoonStar,
      run: async () => {
        const result = await apiFetch<{ sleptCount: number; destroyedCount: number }>(
          '/api/admin/sandboxes/sweep',
          { json: {} },
        );
        return `${result.sleptCount} slept, ${result.destroyedCount} destroyed.`;
      },
    },
    {
      key: 'sync',
      label: 'Sync model catalogue',
      description: 'Re-discover models from enabled upstream providers',
      icon: RefreshCcwDot,
      run: async () => {
        const result = await apiFetch<{ changes?: Array<{ slug: string; kind: string }> }>(
          '/api/admin/models/sync',
          { json: {} },
        );
        const changes = result.changes ?? [];
        return changes.length
          ? `${changes.length} catalogue change${changes.length === 1 ? '' : 's'}.`
          : 'Catalogue already up to date.';
      },
    },
  ];

  const execute = async (job: Job) => {
    setBusyKey(job.key);
    try {
      const message = await job.run();
      toast.success(`${job.label}: done`, { description: message });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(`${job.label} failed`, { description: described.message });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="admin-quick-actions">
      {jobs.map((job) => (
        <Button
          key={job.key}
          size="sm"
          variant="secondary"
          loading={busyKey === job.key}
          disabled={busyKey !== null}
          title={job.description}
          onClick={() => void execute(job)}
        >
          <job.icon aria-hidden="true" className="size-3.5" />
          {job.label}
        </Button>
      ))}
    </div>
  );
}
