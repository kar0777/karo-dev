import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { DiamondAccent, LatticeBackdrop } from '@/components/brand/lattice';
import { getTranslator } from '@/lib/i18n-server';
import { CONTAINER } from '@/components/marketing/section';
import { Button } from '@/components/ui/button';

/**
 * Hero.
 *
 * The trust signals under the CTAs are deliberately unglamorous and
 * verifiable — no logo wall, no invented customer count. Everything
 * claimed here is enforced somewhere in the product.
 */

const TRUST_KEYS = [
  'marketing.hero.trust1',
  'marketing.hero.trust2',
  'marketing.hero.trust3',
  'marketing.hero.trust4',
] as const;

export async function Hero() {
  const t = await getTranslator();
  return (
    <section className="relative isolate overflow-hidden">
      <LatticeBackdrop fade="top" opacity={55} animated />

      <div className={`${CONTAINER} pt-16 pb-12 sm:pt-24 sm:pb-16 lg:pt-28`}>
        <div className="flex max-w-3xl flex-col items-start gap-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12px] text-muted backdrop-blur-sm">
            <DiamondAccent size={6} tone="primary" />
            {t('marketing.hero.badge')}
          </p>

          <h1 className="text-4xl leading-[1.08] text-balance sm:text-5xl lg:text-[3.5rem]">
            {t('marketing.hero.title')}
          </h1>

          <p className="max-w-2xl text-[17px] leading-relaxed text-muted">
            {t('marketing.hero.subtitle')}
          </p>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button asChild size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
              <Link href="/register">{t('marketing.hero.ctaStart')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">{t('marketing.hero.ctaPricing')}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/login?demo=1">{t('marketing.hero.ctaDemo')}</Link>
            </Button>
          </div>

          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-subtle">
            {TRUST_KEYS.map((key, index) => (
              <li key={key} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
