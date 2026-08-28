import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  The Karo mark
 *
 *  Karo is the rhombus. The mark is a diamond held inside a diamond:
 *  the inner solid is the machine that is actually running, the outer
 *  outline is the sandbox boundary around it.
 *
 *  Two deliberate details keep it from reading as a generic diamond
 *  icon:
 *
 *   1. the outer boundary is *open* — a notch on the upper-right edge,
 *      the seam where you reach into the sandbox;
 *   2. the inner solid sits slightly low and left of centre, so the
 *      composition leans away from the notch instead of mirroring it.
 *
 *  Geometry is authored on a 24-unit grid with the outer vertices a
 *  round 9.4 units from centre, which keeps every edge landing on a
 *  half-pixel boundary at 16px, 24px, 32px and 96px.
 * ------------------------------------------------------------------ */

/**
 * Outer boundary, drawn as one open stroke.
 * Starts mid-way up the upper-right edge, runs counter-clockwise around
 * the top, left and bottom vertices, and stops short of where it began.
 */
export const KARO_OUTER_PATH = 'M14.82 5.42 12 2.6 2.6 12 12 21.4 21.4 12 16.89 7.49';

/** Inner solid — offset (-0.5, +0.5) from the centre of the boundary. */
export const KARO_INNER_PATH = 'M11.5 7.9 16.1 12.5 11.5 17.1 6.9 12.5Z';

/** Stroke weight of the boundary on the 24-unit grid. */
export const KARO_STROKE_WIDTH = 1.6;

export type KaroMarkProps = {
  /** Rendered edge length in px. The mark is always square. */
  size?: number;
  className?: string;
  /**
   * Draw the inner solid in `currentColor` instead of jade. Used for
   * favicons, print, and anywhere the mark sits on an unknown surface.
   */
  monochrome?: boolean;
  /**
   * Accessible name. Omit when the mark sits next to a visible wordmark
   * or inside an already-labelled control — it is then decorative.
   */
  title?: string;
};

/**
 * The logomark on its own. The boundary inherits `currentColor` so the
 * mark takes the colour of whatever text it sits in; the inner solid is
 * jade unless `monochrome` is set.
 */
export function KaroMark({ size = 24, className, monochrome = false, title }: KaroMarkProps) {
  const labelled = Boolean(title);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <path
        d={KARO_OUTER_PATH}
        stroke="currentColor"
        strokeWidth={KARO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit={4}
      />
      <path d={KARO_INNER_PATH} fill={monochrome ? 'currentColor' : 'var(--k-primary)'} />
    </svg>
  );
}

export type KaroLogoProps = {
  /** Mark size in px. The wordmark scales with it. */
  size?: number;
  className?: string;
  showWordmark?: boolean;
  monochrome?: boolean;
  /** Extra classes for the wordmark only (e.g. to hide it below `sm`). */
  wordmarkClassName?: string;
};

/**
 * Mark plus wordmark. Renders as a single inline-flex run so it can be
 * dropped straight into a link, a button, or a header row.
 */
export function KaroLogo({
  size = 22,
  className,
  showWordmark = true,
  monochrome = false,
  wordmarkClassName,
}: KaroLogoProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-fg', className)}
      // The mark carries no accessible name when the wordmark is visible,
      // so the group needs one for the wordmark-less variant.
      aria-label={showWordmark ? undefined : 'Karo'}
      role={showWordmark ? undefined : 'img'}
    >
      <KaroMark size={size} monochrome={monochrome} />
      {showWordmark ? (
        <span
          className={cn('font-semibold leading-none tracking-tight', wordmarkClassName)}
          style={{ fontSize: Math.round(size * 0.86) }}
        >
          Karo
        </span>
      ) : null}
    </span>
  );
}
