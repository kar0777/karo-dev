'use client';

import type { ComponentProps } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Thin wrapper so the rest of the app never imports `next-themes`
 * directly, and so the root layout can stay a Server Component.
 *
 * The provider writes `class="light|dark"` onto `<html>`; every Karo
 * colour token flips off that class, which is why components never need
 * `dark:` colour variants.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
