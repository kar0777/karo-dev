import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

/**
 * Chrome for every public page.
 *
 * Marketing type is 15–16px rather than the 13px of the product shell, so the
 * base size is set here instead of on each page.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
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
  );
}
