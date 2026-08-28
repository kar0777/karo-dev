/**
 * Class fragments shared by every Karo primitive.
 *
 * `globals.css` sets a global `:focus-visible` outline that also forces a 5px
 * radius — which fights the larger radii used by cards, popovers and inputs.
 * Interactive primitives therefore opt out of the outline and draw an
 * equivalent ring instead, so the focus indicator always follows the shape of
 * the control it belongs to.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Softer ring for fields, where the border already carries the accent. */
export const focusRingField =
  'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/35';

/** Same, for wrappers that focus through a child input. */
export const focusWithinRingField =
  'focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/35';

/** 150ms is the house transition — fast enough to feel direct, slow enough to read. */
export const transitionBase =
  'transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-[var(--k-ease)]';
