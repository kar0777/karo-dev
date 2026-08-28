import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Ambient texture
 *
 *  The diamond lattice is the only decorative surface Karo uses. It is
 *  always purely decorative — `aria-hidden`, pointer-transparent, and
 *  behind content — so it can never interfere with reading or hit
 *  testing.
 * ------------------------------------------------------------------ */

export type LatticeBackdropProps = {
  className?: string;
  /**
   * `top` fades the lattice out downwards (page and section headers).
   * `full` keeps it edge to edge (empty states, error pages).
   */
  fade?: 'top' | 'full';
  /** 0–100. Kept low by default so the lattice never competes with text. */
  opacity?: number;
  /** Slowly drifts the lattice. Respects `prefers-reduced-motion` globally. */
  animated?: boolean;
};

/**
 * Absolutely-positioned lattice layer. The nearest positioned ancestor
 * should set `relative isolate` so the negative z-index stays scoped.
 */
export function LatticeBackdrop({
  className,
  fade = 'top',
  opacity = 60,
  animated = false,
}: LatticeBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 karo-lattice',
        fade === 'top' && 'karo-lattice-fade',
        animated && 'animate-drift',
        className,
      )}
      style={{ opacity: opacity / 100 }}
    />
  );
}

export type DiamondAccentProps = {
  /** Edge length in px before rotation. 6–8px reads best beside text. */
  size?: number;
  className?: string;
  tone?: 'primary' | 'ember' | 'line' | 'muted';
  /** Outline instead of solid — for "not yet running" section markers. */
  outline?: boolean;
};

const TONE_SOLID: Record<NonNullable<DiamondAccentProps['tone']>, string> = {
  primary: 'bg-primary',
  ember: 'bg-ember',
  line: 'bg-line-strong',
  muted: 'bg-subtle',
};

const TONE_OUTLINE: Record<NonNullable<DiamondAccentProps['tone']>, string> = {
  primary: 'border-primary',
  ember: 'border-ember',
  line: 'border-line-strong',
  muted: 'border-subtle',
};

/**
 * A single rotated square — the mark reduced to one glyph. Used as a
 * section-header marker and as a list bullet in marketing copy.
 */
export function DiamondAccent({
  size = 7,
  className,
  tone = 'primary',
  outline = false,
}: DiamondAccentProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rotate-45',
        outline ? cn('border', TONE_OUTLINE[tone]) : TONE_SOLID[tone],
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

export type DiamondRuleProps = {
  className?: string;
  tone?: DiamondAccentProps['tone'];
};

/**
 * Hairline with a diamond set into it — the section divider used between
 * marketing bands and between grouped panels in the product shell.
 */
export function DiamondRule({ className, tone = 'line' }: DiamondRuleProps) {
  return (
    <div className={cn('flex items-center gap-3', className)} aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <DiamondAccent size={6} tone={tone} />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
