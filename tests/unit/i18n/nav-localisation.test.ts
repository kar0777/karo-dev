import { describe, expect, it } from 'vitest';

import { APP_NAV, buildBreadcrumbs, localizeNav } from '@/components/app/nav';
import { createTranslator, getDictionary, LOCALES } from '@/lib/i18n';

/**
 * Guards the wiring between the dictionary and the navigation.
 *
 * The dictionary and the nav table were both complete and had never been
 * connected: 563 translated keys on one side, hard-coded English labels on the
 * other, and nothing in between. These cases assert the connection exists and
 * that it degrades the way it is supposed to.
 */

describe('navigation localisation', () => {
  it('translates every group and item label into Russian', () => {
    const localized = localizeNav(createTranslator('ru'));

    const groups = localized.map((group) => group.label);
    expect(groups).toEqual(['Разработка', 'Расширения', 'Аккаунт']);

    const byHref = new Map(
      localized.flatMap((group) => group.items).map((item) => [item.href, item.label]),
    );
    expect(byHref.get('/app')).toBe('Обзор');
    expect(byHref.get('/app/projects')).toBe('Проекты');
    expect(byHref.get('/app/sandboxes')).toBe('Песочницы');
    expect(byHref.get('/app/api-keys')).toBe('API-ключи');
    expect(byHref.get('/app/settings')).toBe('Настройки');
  });

  it('is a no-op in English — the table already holds the English copy', () => {
    const localized = localizeNav(createTranslator('en'));

    for (const [index, group] of localized.entries()) {
      const original = APP_NAV[index];
      expect(group.label).toBe(original?.label);
      for (const [itemIndex, item] of group.items.entries()) {
        expect(item.label).toBe(original?.items[itemIndex]?.label);
      }
    }
  });

  it('leaves the shared table untouched, whatever locale rendered last', () => {
    const before = APP_NAV.map((group) => [
      group.label,
      ...group.items.map((item) => item.label),
    ]);

    localizeNav(createTranslator('ru'));

    expect(
      APP_NAV.map((group) => [group.label, ...group.items.map((item) => item.label)]),
    ).toEqual(before);
  });

  it('resolves every labelKey in every locale — no key falls through to itself', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(locale);
      for (const group of APP_NAV) {
        if (group.labelKey) {
          expect(t(group.labelKey), `${locale}: ${group.labelKey}`).not.toBe(group.labelKey);
        }
        for (const item of group.items) {
          if (item.labelKey) {
            expect(t(item.labelKey), `${locale}: ${item.labelKey}`).not.toBe(item.labelKey);
          }
        }
      }
    }
  });

  it('keeps both dictionaries structurally identical, key for key', () => {
    const shape = (value: unknown): unknown =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .map(([key, nested]) => [key, shape(nested)])
              .sort(([a], [b]) => String(a).localeCompare(String(b))),
          )
        : typeof value;

    expect(shape(getDictionary('ru'))).toEqual(shape(getDictionary('en')));
  });
});

describe('breadcrumb localisation', () => {
  it('translates the segments that have a dictionary key', () => {
    const crumbs = buildBreadcrumbs('/app/projects', createTranslator('ru'));
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Karo', 'Проекты']);
  });

  it('leaves segments with no key in English rather than blanking them', () => {
    // `conversations` has no equivalent key on purpose — see SEGMENT_LABEL_KEYS.
    const crumbs = buildBreadcrumbs('/app/conversations', createTranslator('ru'));
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Karo', 'Chat']);
  });

  it('still shortens record ids when translating', () => {
    const crumbs = buildBreadcrumbs(
      '/app/projects/prj_01kyft44ytevtcq1nv9ep2',
      createTranslator('ru'),
    );
    expect(crumbs.at(-1)?.label).toMatch(/^prj_01ky…$/);
  });

  it('produces byte-identical output with and without an English translator', () => {
    // The invariant that matters while the rest of the UI is still being wired:
    // routing copy through the dictionary must not reword the English product.
    // Two labels have already tried to drift this way.
    for (const path of [
      '/app',
      '/app/projects',
      '/app/sandboxes',
      '/app/api-keys',
      '/app/settings',
      '/app/team/join',
      '/app/skills/new',
    ]) {
      expect(buildBreadcrumbs(path, createTranslator('en')), path).toEqual(
        buildBreadcrumbs(path),
      );
    }
  });
});
