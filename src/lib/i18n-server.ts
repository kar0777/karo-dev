import 'server-only';

import { headers } from 'next/headers';

import {
  DEFAULT_LOCALE,
  createTranslator,
  getLocaleFromHeader,
  normalizeLocale,
  type Locale,
  type Translator,
} from '@/lib/i18n';

/**
 * Server-side locale resolution.
 *
 * `@/lib/i18n` had everything needed to translate — 563 keys, both dictionaries
 * statically imported, a typed `t()` — and three files imported it, none of them
 * to render UI. The missing piece was never the dictionary. It was that no
 * component could find out *which locale to use*: the value sits on
 * `users.locale`, and nothing read it back.
 *
 * This is that half, for Server Components. The client half is
 * `@/components/i18n-provider`.
 *
 * Order of preference, and why:
 *
 *  1. **The signed-in user's saved choice.** Explicit beats inferred. A user who
 *     picked Russian in Settings means it on every device, including one whose
 *     browser asks for English.
 *  2. **`Accept-Language`.** The best guess available before anyone has chosen,
 *     which is the entire pre-sign-up experience.
 *  3. **English.**
 *
 * Note the caller passes the user rather than this module loading one. Reading
 * the session here would drag auth into every layout that wants a translated
 * word, and quietly opt static pages into dynamic rendering.
 */

/** Anything carrying a locale column. Loose on purpose — a row, a session, a DTO. */
export type LocaleBearer = { locale?: string | null } | null | undefined;

/**
 * Resolves the locale for a request.
 *
 * Safe to call outside a request scope: `headers()` throws there, and this
 * returns the default instead of propagating.
 */
export async function resolveLocale(user?: LocaleBearer): Promise<Locale> {
  if (user?.locale) return normalizeLocale(user.locale);

  try {
    const headerList = await headers();
    return getLocaleFromHeader(headerList.get('accept-language'));
  } catch {
    // Not in a request — a script, a build-time evaluation, a test.
    return DEFAULT_LOCALE;
  }
}

/**
 * A bound `t()` for a Server Component.
 *
 * ```tsx
 * const t = await getTranslator(user);
 * return <h1>{t('dashboard.title')}</h1>;
 * ```
 */
export async function getTranslator(user?: LocaleBearer): Promise<Translator> {
  return createTranslator(await resolveLocale(user));
}
