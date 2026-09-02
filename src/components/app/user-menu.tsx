'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  Check,
  CreditCard,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { useSession } from '@/components/app/session-provider';
import { useLocale, useTranslator } from '@/components/i18n-provider';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { useMounted } from '@/lib/hooks/use-mounted';
import { ROLE_LABELS } from '@/lib/rbac/permissions';
import { cn, initials } from '@/lib/utils';

/**
 * `label` is the English fallback and `labelKey` the dictionary entry. Both are
 * present so this table stays readable on its own and so a missing key degrades
 * to the word rather than to nothing.
 */
const THEMES = [
  { value: 'light', label: 'Light', labelKey: 'common.themeLight', icon: Sun },
  { value: 'dark', label: 'Dark', labelKey: 'common.themeDark', icon: Moon },
  { value: 'system', label: 'System', labelKey: 'common.themeSystem', icon: Monitor },
] as const;

export type UserMenuProps = { collapsed?: boolean };

export function UserMenu({ collapsed = false }: UserMenuProps) {
  const { user, role } = useSession();
  const t = useTranslator();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { locale } = useLocale();
  const [savingLocale, setSavingLocale] = React.useState(false);
  const mounted = useMounted();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // The session lives on the server, so a call that failed leaves this
      // device signed in. Navigating on regardless would look like a sign-out
      // and then bounce off /login straight back into the app — on a shared
      // machine, the one outcome worth refusing to imply.
      const { message } = describeError(error);
      toast.error('Could not sign out', {
        description: `${message} This device may still be signed in — try again.`,
      });
      setSigningOut(false);
      return;
    }
    // A hard navigation, so no stale server-rendered payload survives.
    window.location.assign('/login');
  }

  async function changeLocale(next: Locale) {
    if (next === locale || savingLocale) return;
    setSavingLocale(true);
    try {
      await apiFetch('/api/settings/profile', { method: 'PATCH', json: { locale: next } });
      // The layout re-resolves the locale from the saved preference.
      router.refresh();
    } catch (error) {
      const { message } = describeError(error);
      toast.error(t('common.errorTitle'), { description: message });
    } finally {
      setSavingLocale(false);
    }
  }

  const displayName = user.name.trim() || user.email;

  const trigger = (
    <button
      type="button"
      aria-label={`Account menu for ${displayName}`}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-transparent p-1.5 text-left',
        'transition-colors duration-150 ease-[var(--k-ease)] hover:border-line hover:bg-surface-2',
        collapsed && 'justify-center',
      )}
    >
      <Avatar size="sm" shape="circle" className="shrink-0">
        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg">{displayName}</span>
          <span className="block truncate text-[11px] text-subtle">{ROLE_LABELS[role]}</span>
        </span>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{displayName}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="normal-case">
          <span className="block truncate text-[12px] font-medium tracking-normal text-fg">
            {displayName}
          </span>
          <span className="block truncate text-[11px] font-normal tracking-normal text-subtle lowercase">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => router.push('/app/settings')} className="gap-2">
          <Settings className="size-4" aria-hidden="true" />
          {t('nav.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/team')} className="gap-2">
          <Users className="size-4" aria-hidden="true" />
          {t('nav.team')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/billing')} className="gap-2">
          <CreditCard className="size-4" aria-hidden="true" />
          {t('nav.billing')}
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Sun className="size-4" aria-hidden="true" />
            {t('common.theme')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {THEMES.map((option) => {
              const Icon = option.icon;
              const active = mounted && (theme ?? 'system') === option.value;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => setTheme(option.value)}
                  className="justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" aria-hidden="true" />
                    {t(option.labelKey)}
                  </span>
                  {active ? (
                    <Check className="size-3.5 text-primary" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Languages className="size-4" aria-hidden="true" />
            {t('common.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {LOCALES.map((code) => (
              <DropdownMenuItem
                key={code}
                disabled={savingLocale}
                onSelect={() => void changeLocale(code)}
                className="justify-between gap-2"
              >
                <span>{LOCALE_NAMES[code]}</span>
                {locale === code ? (
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {user.platformRole === 'admin' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/admin')} className="gap-2">
              <Shield className="size-4" aria-hidden="true" />
              Platform admin
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="danger"
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          className="gap-2"
        >
          <LogOut className="size-4" aria-hidden="true" />
          {signingOut ? t('common.signingOut') : t('common.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
