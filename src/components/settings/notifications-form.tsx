'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Save } from 'lucide-react';

import {
  NOTIFICATION_META,
  type NotificationKey,
  type NotificationPreferences,
} from '@/lib/account/preferences';
import { apiFetch, describeError } from '@/lib/client/api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  Switch,
  toast,
} from '@/components/ui';

const ORDER: NotificationKey[] = [
  'usageAlerts',
  'runCompletion',
  'billingEvents',
  'weeklyDigest',
  'securityAlerts',
];

export function NotificationsForm({
  initial,
  usageAlertThresholdPercent,
}: {
  initial: NotificationPreferences;
  /** Team-level trigger point, shown so "usage alerts" means something concrete. */
  usageAlertThresholdPercent: number;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = ORDER.some((key) => values[key] !== initial[key]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;

    setSaving(true);
    setError(null);

    try {
      await apiFetch('/api/settings/notifications', {
        method: 'PATCH',
        json: {
          usageAlerts: values.usageAlerts,
          runCompletion: values.runCompletion,
          billingEvents: values.billingEvents,
          weeklyDigest: values.weeklyDigest,
        },
      });
      toast.success('Notification preferences saved');
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            What Karo tells you about, in the app and by email. Your team&apos;s usage alert
            fires at {usageAlertThresholdPercent}% of quota.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <ul className="space-y-3.5">
            {ORDER.map((key) => {
              const meta = NOTIFICATION_META[key];
              return (
                <li key={key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor={`notify-${key}`}
                        className="text-[13px] font-medium text-fg"
                      >
                        {meta.label}
                      </label>
                      {meta.locked ? (
                        <Badge variant="outline" size="sm">
                          <Lock className="size-3" aria-hidden="true" />
                          Always on
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                      {meta.description}
                    </p>
                  </div>
                  <Switch
                    id={`notify-${key}`}
                    checked={values[key]}
                    disabled={meta.locked}
                    onCheckedChange={(next) =>
                      setValues((current) => ({ ...current, [key]: next }))
                    }
                  />
                </li>
              );
            })}
          </ul>

          {error ? <FieldError>{error}</FieldError> : null}
        </CardContent>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span aria-live="polite" className="mr-auto text-[12px] text-subtle">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button type="submit" loading={saving} disabled={!dirty} iconLeft={<Save />}>
            Save preferences
          </Button>
        </div>
      </Card>
    </form>
  );
}
