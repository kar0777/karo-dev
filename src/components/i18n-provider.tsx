'use client';

import * as React from 'react';

import {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  createTranslator,
  type Locale,
  type Translator,
} from '@/lib/i18n';

/**
 * Client-side locale context.
 *
 * Carries only the locale, not a dictionary. `@/lib/i18n` imports both JSON
 * files statically and looks up synchronously, by design — so a Client Component
 * can build its own translator from a two-letter string and there is nothing to
 * serialise across the boundary.
 *
 * That design has one cost worth naming: both dictionaries are in the client
 * bundle, roughly 65 KB of JSON today. At two locales that is a fair trade for
 * having no provider to await and no loading state; at ten it would not be, and
 * the fix then is a per-locale dynamic import behind this same hook, with no
 * change to any caller.
 */

type I18nValue = {
  locale: Locale;
  t: Translator;
  /** BCP-47 tag, for `Intl.*` and `toLocaleString`. */
  tag: string;
};

const I18nContext = React.createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = React.useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(locale), tag: LOCALE_TAGS[locale] }),
    [locale],
  );

  /**
   * Keeps `<html lang>` honest.
   *
   * The root layout cannot do this. It is shared with the marketing site, whose
   * pages are prerendered — reading the session or `Accept-Language` up there
   * would opt every one of them into dynamic rendering to change one attribute.
   * So the server renders `lang="en"` and this corrects it after hydration,
   * which is what screen readers, `hyphens`, spellcheck and font selection
   * actually read. The window where it is wrong is the same window in which no
   * assistive technology has queried it yet.
   */
  React.useEffect(() => {
    const root = document.documentElement;
    if (root.lang !== locale) root.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The translator for the current locale.
 *
 * Falls back to English rather than throwing when used outside a provider:
 * plenty of components are shared between the authenticated shell and the public
 * pages, and a missing provider should cost a translation, not a crash.
 */
export function useTranslator(): Translator {
  const value = React.useContext(I18nContext);
  return value?.t ?? FALLBACK.t;
}

/** The resolved locale, for `Intl` work and for the language picker. */
export function useLocale(): { locale: Locale; tag: string } {
  const value = React.useContext(I18nContext);
  return value
    ? { locale: value.locale, tag: value.tag }
    : { locale: FALLBACK.locale, tag: FALLBACK.tag };
}

const FALLBACK: I18nValue = {
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
  tag: LOCALE_TAGS[DEFAULT_LOCALE],
};
