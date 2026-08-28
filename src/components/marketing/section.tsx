import type * as React from 'react';

import { DiamondAccent } from '@/components/brand/lattice';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Marketing band primitives
 *
 *  Every public page is a stack of full-bleed bands separated by a
 *  single hairline. The rhythm is deliberately tighter than a typical
 *  SaaS page — Karo is a workshop, not a billboard — so the vertical
 *  padding tops out at 6rem instead of the usual 10.
 * ------------------------------------------------------------------ */

export const CONTAINER = 'mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8';

export interface SectionProps extends React.ComponentProps<'section'> {
  /** Anchor target. Sub-navs on /features and /docs link to these. */
  id?: string;
  /** `inset` recesses the band so alternating sections read as separate. */
  tone?: 'default' | 'inset';
  /** Off for the hero, which owns its own spacing. */
  divider?: boolean;
  /** Tighter band for short interstitials. */
  size?: 'sm' | 'md';
  containerClassName?: string;
}

export function Section({
  id,
  tone = 'default',
  divider = true,
  size = 'md',
  className,
  containerClassName,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        'relative isolate scroll-mt-20',
        divider && 'border-t border-line',
        tone === 'inset' && 'bg-bg-inset',
        size === 'md' ? 'py-16 sm:py-20 lg:py-24' : 'py-12 sm:py-14',
        className,
      )}
      {...props}
    >
      <div className={cn(CONTAINER, containerClassName)}>{children}</div>
    </section>
  );
}

export interface EyebrowProps extends React.ComponentProps<'p'> {
  tone?: 'primary' | 'ember' | 'muted';
}

/** Small label above a section heading. Always paired with a diamond. */
export function Eyebrow({ tone = 'primary', className, children, ...props }: EyebrowProps) {
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase',
        tone === 'primary' && 'text-primary',
        tone === 'ember' && 'text-ember',
        tone === 'muted' && 'text-subtle',
        className,
      )}
      {...props}
    >
      <DiamondAccent size={6} tone={tone === 'muted' ? 'line' : tone} />
      {children}
    </p>
  );
}

export interface SectionIntroProps {
  eyebrow?: React.ReactNode;
  eyebrowTone?: EyebrowProps['tone'];
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
  /** Rendered under the description — usually a CTA row or a stat strip. */
  children?: React.ReactNode;
  className?: string;
  /**
   * `h2` everywhere except the one section that owns the page title, which
   * passes `h1`.
   *
   * `h1` was missing from this union until the whole public site turned out to
   * have exactly one `h1` across eight pages — the landing page, which builds its
   * hero by hand. Every other page opened at `h2`, so assistive technology got a
   * document with no title in its heading outline and search engines lost the
   * strongest on-page signal there is. Each page should pass `as="h1"` on its
   * first intro and leave the rest alone.
   */
  as?: 'h1' | 'h2' | 'h3';
}

export function SectionIntro({
  eyebrow,
  eyebrowTone = 'primary',
  title,
  description,
  align = 'left',
  children,
  className,
  as: Heading = 'h2',
}: SectionIntroProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      {eyebrow ? <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow> : null}
      <Heading
        className={cn(
          'text-balance',
          Heading === 'h2' ? 'text-2xl sm:text-3xl lg:text-[2.125rem]' : 'text-xl sm:text-2xl',
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p
          className={cn(
            'max-w-2xl text-[15px] leading-relaxed text-muted',
            align === 'center' && 'mx-auto',
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** Bulleted marketing list with the Karo diamond as the marker. */
export function DiamondList({
  items,
  className,
  tone = 'primary',
}: {
  items: readonly React.ReactNode[];
  className?: string;
  tone?: 'primary' | 'ember' | 'line';
}) {
  return (
    <ul className={cn('flex flex-col gap-2.5', className)}>
      {items.map((item, index) => (
        <li
          key={index}
          className="flex items-start gap-2.5 text-[14px] leading-relaxed text-muted"
        >
          <DiamondAccent size={6} tone={tone} className="mt-[0.5em]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Dense label/value row used inside spec panels and diagrams. */
export function SpecRow({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0',
        className,
      )}
    >
      <span className="text-[13px] text-muted">{label}</span>
      <span className="karo-numeric text-right text-[13px] font-medium text-fg">{value}</span>
    </div>
  );
}
