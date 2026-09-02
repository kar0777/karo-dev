import type { ReactNode } from 'react';

import { I18nProvider } from '@/components/i18n-provider';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { resolveLocale } from '@/lib/i18n-server';

/**
 * Chrome for every public page.
 *
 * Marketing type is 15–16px rather than the 13px of the product shell, so the
 * base size is set here instead of on each page.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  // Pre-sign-up locale: nobody has saved a preference yet, so Accept-Language decides.
  const locale = await resolveLocale();

  return (
    <I18nProvider locale={locale}>
      <div className="flex min-h-dvh flex-col bg-bg text-[15px] text-fg">
        <a
          href="#main"
          className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-md focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-fg focus:shadow-pop"
        >
          Skip to content
        </a>

        <SiteHeader />

        <main id="main" className="flex-1">
          {children}
        </main>

        <SiteFooter />
      </div>
    </I18nProvider>
  );
}
