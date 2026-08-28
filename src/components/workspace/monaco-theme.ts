import type { Monaco } from '@monaco-editor/react';

/**
 * The Karo Monaco theme.
 *
 * Karo's design tokens are authored in OKLCH, which Monaco cannot consume, so
 * the palette is read from the live stylesheet at runtime and converted to
 * sRGB. That keeps the editor in step with a token edit instead of drifting
 * from it. The constants below are the same values precomputed, used when the
 * custom properties cannot be read (SSR hand-off, or a browser that resolves
 * them to something unexpected).
 */

export const KARO_THEME_DARK = 'karo-dark';
export const KARO_THEME_LIGHT = 'karo-light';

type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  fg: string;
  muted: string;
  subtle: string;
  primary: string;
  ember: string;
  danger: string;
  success: string;
  warning: string;
  info: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  c5: string;
  c6: string;
};

const DARK_FALLBACK: Palette = {
  bg: '#080705',
  surface: '#141210',
  surface2: '#1b1916',
  surface3: '#22201d',
  border: '#2a2825',
  fg: '#f1f0ee',
  muted: '#a8a6a3',
  subtle: '#7b7974',
  primary: '#54d2a8',
  ember: '#f9a555',
  danger: '#f55f5e',
  success: '#72cf8e',
  warning: '#eebb58',
  info: '#65afeb',
  c1: '#53d1a8',
  c2: '#f8a558',
  c3: '#5eaceb',
  c4: '#da89d7',
  c5: '#a2ca6c',
  c6: '#ef7e80',
};

const LIGHT_FALLBACK: Palette = {
  bg: '#f2f1ee',
  surface: '#ffffff',
  surface2: '#f7f6f3',
  surface3: '#eeece9',
  border: '#e1e0dc',
  fg: '#211d19',
  muted: '#5b5753',
  subtle: '#83807b',
  primary: '#007052',
  ember: '#a85b05',
  danger: '#c02b2c',
  success: '#1e7546',
  warning: '#b07a00',
  info: '#206ea6',
  c1: '#1c8f6e',
  c2: '#bf7028',
  c3: '#297ab6',
  c4: '#ac5faa',
  c5: '#71943f',
  c6: '#bb565a',
};

/* ------------------------------------------------------------------ *
 *  Colour conversion
 * ------------------------------------------------------------------ */

function toChannel(value: number): string {
  const gamma =
    value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
  const byte = Math.round(Math.min(1, Math.max(0, gamma)) * 255);
  return byte.toString(16).padStart(2, '0');
}

/** `oklch(0.78 0.128 168)` → `#54d2a8`. Alpha is dropped; Monaco has no use for it. */
export function oklchToHex(input: string): string | null {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/.*)?\)$/i.exec(
    input.trim(),
  );
  if (!match) return null;

  const parse = (raw: string, percentBase: number) =>
    raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * percentBase : Number.parseFloat(raw);

  const L = parse(match[1] ?? '0', 1);
  const C = parse(match[2] ?? '0', 0.4);
  const H = Number.parseFloat(match[3] ?? '0');
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;

  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);

  const lp = L + 0.3963377774 * a + 0.2158037573 * b;
  const mp = L - 0.1055613458 * a - 0.0638541728 * b;
  const sp = L - 0.0894841775 * a - 1.291485548 * b;

  const l = lp ** 3;
  const m = mp ** 3;
  const s = sp ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return `#${toChannel(r)}${toChannel(g)}${toChannel(bl)}`;
}

function normalizeColor(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [, r = '0', g = '0', b = '0'] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((part) =>
      Math.round(Number.parseFloat(part ?? '0'))
        .toString(16)
        .padStart(2, '0'),
    );
    return `#${channels.join('')}`;
  }
  return oklchToHex(value);
}

function readPalette(fallback: Palette): Palette {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const styles = window.getComputedStyle(document.documentElement);
  const pick = (token: string, backup: string) =>
    normalizeColor(styles.getPropertyValue(token)) ?? backup;

  return {
    bg: pick('--k-bg-inset', fallback.bg),
    surface: pick('--k-surface-1', fallback.surface),
    surface2: pick('--k-surface-2', fallback.surface2),
    surface3: pick('--k-surface-3', fallback.surface3),
    border: pick('--k-border', fallback.border),
    fg: pick('--k-fg', fallback.fg),
    muted: pick('--k-fg-muted', fallback.muted),
    subtle: pick('--k-fg-subtle', fallback.subtle),
    primary: pick('--k-primary', fallback.primary),
    ember: pick('--k-ember', fallback.ember),
    danger: pick('--k-danger', fallback.danger),
    success: pick('--k-success', fallback.success),
    warning: pick('--k-warning', fallback.warning),
    info: pick('--k-info', fallback.info),
    c1: pick('--k-chart-1', fallback.c1),
    c2: pick('--k-chart-2', fallback.c2),
    c3: pick('--k-chart-3', fallback.c3),
    c4: pick('--k-chart-4', fallback.c4),
    c5: pick('--k-chart-5', fallback.c5),
    c6: pick('--k-chart-6', fallback.c6),
  };
}

/** Monaco wants rule colours without the leading `#`. */
const bare = (hex: string) => hex.replace('#', '');

function buildTheme(palette: Palette, base: 'vs' | 'vs-dark') {
  return {
    base,
    inherit: true,
    rules: [
      { token: '', foreground: bare(palette.fg), background: bare(palette.bg) },
      { token: 'comment', foreground: bare(palette.subtle), fontStyle: 'italic' },
      { token: 'keyword', foreground: bare(palette.c4) },
      { token: 'keyword.flow', foreground: bare(palette.c4) },
      { token: 'operator', foreground: bare(palette.muted) },
      { token: 'string', foreground: bare(palette.c5) },
      { token: 'string.escape', foreground: bare(palette.c2) },
      { token: 'number', foreground: bare(palette.c2) },
      { token: 'regexp', foreground: bare(palette.c5) },
      { token: 'type', foreground: bare(palette.c3) },
      { token: 'type.identifier', foreground: bare(palette.c3) },
      { token: 'identifier', foreground: bare(palette.fg) },
      { token: 'variable', foreground: bare(palette.c3) },
      { token: 'variable.predefined', foreground: bare(palette.c6) },
      { token: 'function', foreground: bare(palette.c1) },
      { token: 'entity.name.function', foreground: bare(palette.c1) },
      { token: 'constant', foreground: bare(palette.c2) },
      { token: 'tag', foreground: bare(palette.c4) },
      { token: 'attribute.name', foreground: bare(palette.c3) },
      { token: 'attribute.value', foreground: bare(palette.c5) },
      { token: 'delimiter', foreground: bare(palette.muted) },
      { token: 'metatag', foreground: bare(palette.c6) },
      { token: 'annotation', foreground: bare(palette.c6) },
      { token: 'key', foreground: bare(palette.c3) },
      { token: 'invalid', foreground: bare(palette.danger) },
    ],
    colors: {
      'editor.background': palette.bg,
      'editor.foreground': palette.fg,
      'editorLineNumber.foreground': palette.subtle,
      'editorLineNumber.activeForeground': palette.fg,
      'editorCursor.foreground': palette.primary,
      'editor.selectionBackground': `${palette.primary}33`,
      'editor.inactiveSelectionBackground': `${palette.primary}1f`,
      'editor.selectionHighlightBackground': `${palette.primary}22`,
      'editor.wordHighlightBackground': `${palette.primary}1a`,
      'editor.wordHighlightStrongBackground': `${palette.primary}26`,
      'editor.lineHighlightBackground': palette.surface2,
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': palette.border,
      'editorIndentGuide.activeBackground1': palette.subtle,
      'editorWhitespace.foreground': palette.border,
      'editorGutter.background': palette.bg,
      'editorGutter.addedBackground': palette.success,
      'editorGutter.modifiedBackground': palette.info,
      'editorGutter.deletedBackground': palette.danger,
      'editorBracketMatch.background': `${palette.primary}22`,
      'editorBracketMatch.border': palette.primary,
      'editorWidget.background': palette.surface,
      'editorWidget.border': palette.border,
      'editorSuggestWidget.background': palette.surface,
      'editorSuggestWidget.border': palette.border,
      'editorSuggestWidget.selectedBackground': palette.surface3,
      'editorSuggestWidget.highlightForeground': palette.primary,
      'editorHoverWidget.background': palette.surface,
      'editorHoverWidget.border': palette.border,
      'editorError.foreground': palette.danger,
      'editorWarning.foreground': palette.warning,
      'editorInfo.foreground': palette.info,
      'scrollbarSlider.background': `${palette.border}cc`,
      'scrollbarSlider.hoverBackground': palette.subtle,
      'scrollbarSlider.activeBackground': palette.subtle,
      'minimap.background': palette.bg,
      'editorOverviewRuler.border': '#00000000',
      focusBorder: palette.primary,
    },
  };
}

/**
 * Registers both Karo themes.
 *
 * `getComputedStyle` can only see the theme that is currently applied, so the
 * active one is built from live tokens and the other from the precomputed
 * table. Call this again whenever the app theme flips and both will be right.
 */
export function defineKaroMonacoThemes(monaco: Monaco, isDark: boolean): void {
  const live = readPalette(isDark ? DARK_FALLBACK : LIGHT_FALLBACK);
  monaco.editor.defineTheme(
    KARO_THEME_DARK,
    buildTheme(isDark ? live : DARK_FALLBACK, 'vs-dark'),
  );
  monaco.editor.defineTheme(KARO_THEME_LIGHT, buildTheme(isDark ? LIGHT_FALLBACK : live, 'vs'));
}
