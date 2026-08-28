'use client';

import { useTheme } from 'next-themes';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { useMounted } from '@/lib/hooks/use-mounted';
import { cn } from '@/lib/utils';

type ThemeOption = 'light' | 'dark' | 'system';

const OPTIONS: ReadonlyArray<{
  value: ThemeOption;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export type ThemeToggleProps = {
  className?: string;
  /** `icon` is the header control; `menu` is for inside an existing sheet. */
  size?: 'icon-sm' | 'icon';
  align?: 'start' | 'center' | 'end';
};

/**
 * Theme switcher.
 *
 * Rendering is deliberately identical on the server and on the first
 * client paint (a static sun glyph) — the real state only appears after
 * mount, because the resolved theme is not knowable during SSR.
 */
export function ThemeToggle({ className, size = 'icon-sm', align = 'end' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const selected: ThemeOption = mounted
    ? ((theme as ThemeOption | undefined) ?? 'system')
    : 'system';
  const CurrentIcon = !mounted ? Sun : resolvedTheme === 'light' ? Sun : Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={cn('text-muted hover:text-fg', className)}
          aria-label={mounted ? `Theme: ${selected}` : 'Theme'}
        >
          <CurrentIcon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="w-40">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = mounted && selected === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-subtle" aria-hidden="true" />
                {option.label}
              </span>
              {active ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
