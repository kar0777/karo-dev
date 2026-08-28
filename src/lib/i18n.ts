import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';

/* ------------------------------------------------------------------ *
 *  Translation layer
 *
 *  Deliberately dependency-free. Both dictionaries are statically
 *  imported, so lookups are synchronous everywhere — Server Components,
 *  Client Components, route handlers and scripts alike — and there is
 *  no provider to mount and no async boundary to await.
 *
 *  The English file is the source of truth: `Dictionary` is derived from
 *  it, so a key added there but missing from `ru.json` is a type error,
 *  not a runtime hole.
 * ------------------------------------------------------------------ */

export type Locale = 'en' | 'ru';

export const LOCALES: readonly Locale[] = ['en', 'ru'];

export const DEFAULT_LOCALE: Locale = 'en';

/** Endonyms — a language picker should read in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
};

/** BCP-47 tags for `Intl.*`. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  ru: 'ru-RU',
};

export type Dictionary = typeof en;

/**
 * `ru` is checked against the English shape here. If the two files drift
 * apart, this assignment fails to compile.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { en, ru };

/* ------------------------------------------------------------------ *
 *  Keys
 * ------------------------------------------------------------------ */

type Leaf = string | number | boolean | null;

type DotPaths<T> = T extends Leaf
  ? never
  : {
      [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${DotPaths<T[K]>}`;
    }[keyof T & string];

/** Every dot-path that resolves to a string in `en.json`. */
export type TranslationKey = DotPaths<Dictionary>;

/**
 * Known keys autocomplete; unknown keys still type-check so that copy
 * can be referenced before it is added to the dictionary (it renders as
 * the key itself, which is loud enough to catch in review).
 */
export type LooseTranslationKey = TranslationKey | (string & {});

export type TranslationParams = Record<string, string | number>;

/* ------------------------------------------------------------------ *
 *  Lookup
 * ------------------------------------------------------------------ */

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale);
}

/** Coerces anything (a DB column, a cookie, a query param) to a locale. */
export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  if (typeof value === 'string') {
    const base = value.toLowerCase().split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

function resolve(source: unknown, key: string): string | undefined {
  let node: unknown = source;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, params: TranslationParams): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    // An unsupplied placeholder stays literal rather than printing
    // "undefined" in the middle of a sentence.
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolves `key` against `dict`, falling back to English and finally to
 * the key itself. `{name}` placeholders are replaced from `params`.
 *
 * ```ts
 * t(dict, 'dashboard.welcomeBack', { name: user.name })
 * ```
 */
export function t(
  dict: Dictionary,
  key: LooseTranslationKey,
  params?: TranslationParams,
): string {
  const template = resolve(dict, key) ?? resolve(en, key);
  if (template === undefined) return key;
  return params ? interpolate(template, params) : template;
}

export type Translator = (key: LooseTranslationKey, params?: TranslationParams) => string;

/** Binds a locale once so components can call `t('nav.projects')`. */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const dict = getDictionary(locale);
  return (key, params) => t(dict, key, params);
}

/* ------------------------------------------------------------------ *
 *  Formatting helpers
 * ------------------------------------------------------------------ */

/**
 * "bash, sh and powershell" / «bash, sh и powershell».
 * Used for permission lists, allowed shells, and tool summaries.
 */
export function formatList(
  items: readonly string[],
  locale: Locale = DEFAULT_LOCALE,
  type: 'conjunction' | 'disjunction' = 'conjunction',
): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return new Intl.ListFormat(LOCALE_TAGS[locale], { style: 'long', type }).format(items);
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Quality values are honoured; ties keep the order the client sent,
 * which is itself a preference. Region subtags are matched on their
 * base language, so `ru-BY` resolves to `ru`.
 */
export function getLocaleFromHeader(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [rawTag, ...directives] = part.trim().split(';');
      const qDirective = directives.find((d) => d.trim().toLowerCase().startsWith('q='));
      const parsedQ = qDirective ? Number.parseFloat(qDirective.trim().slice(2)) : 1;
      return {
        tag: (rawTag ?? '').trim().toLowerCase(),
        q: Number.isFinite(parsedQ) ? parsedQ : 0,
        index,
      };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const entry of ranked) {
    if (entry.tag === '*') return DEFAULT_LOCALE;
    const base = entry.tag.split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
