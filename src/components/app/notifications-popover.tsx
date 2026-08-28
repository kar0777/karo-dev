'use client';

import Link from 'next/link';

import { Bell, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';

import type { ShellNotification } from '@/components/app/shell-data';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, formatRelativeTime } from '@/lib/utils';

const LEVEL_META = {
  info: { icon: Info, className: 'text-info' },
  success: { icon: CircleCheck, className: 'text-primary' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleAlert, className: 'text-danger' },
} as const;

export type NotificationsPopoverProps = {
  notifications: readonly ShellNotification[];
  unreadCount: number;
};

export function NotificationsPopover({
  notifications,
  unreadCount,
}: NotificationsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative text-muted hover:text-fg"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, none unread'
          }
        >
          <Bell className="size-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-ember ring-2 ring-bg"
            />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <p className="text-[13px] font-medium text-fg">Notifications</p>
          {unreadCount > 0 ? (
            <span className="karo-numeric text-[11px] text-ember">{unreadCount} unread</span>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell className="mx-auto size-5 text-subtle" aria-hidden="true" />
            <p className="mt-2 text-[13px] font-medium text-fg">Nothing to catch up on</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Karo tells you here when a run finishes, a sandbox fails to start, or the team is
              close to a quota limit.
            </p>
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((notification) => {
              const meta = LEVEL_META[notification.level];
              const Icon = meta.icon;
              return (
                <li key={notification.id}>
                  <div
                    className={cn(
                      'flex gap-2.5 px-3 py-2.5',
                      !notification.read && 'bg-primary-soft/25',
                    )}
                  >
                    <Icon
                      className={cn('mt-0.5 size-4 shrink-0', meta.className)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug font-medium text-fg">
                        {notification.title}
                      </p>
                      {notification.body ? (
                        <p className="mt-0.5 text-[12px] leading-snug text-muted">
                          {notification.body}
                        </p>
                      ) : null}
                      <div className="mt-1 flex items-center gap-2">
                        <time
                          dateTime={notification.createdAt}
                          className="text-[11px] text-subtle"
                        >
                          {formatRelativeTime(notification.createdAt)}
                        </time>
                        {notification.actionHref ? (
                          <Link
                            href={notification.actionHref}
                            className="rounded-sm text-[11px] font-medium text-primary hover:underline"
                          >
                            {notification.actionLabel ?? 'Open'}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
