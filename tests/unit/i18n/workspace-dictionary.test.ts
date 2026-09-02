import { describe, expect, it } from 'vitest';

import { createTranslator, getDictionary } from '@/lib/i18n';

/**
 * The workspace shell reads tab names and run statuses from the dictionary.
 * A key that resolves to itself (the "loud" fallback) in either locale would
 * print the raw dot-path in the tab strip, so pin the whole grid here.
 */
describe('workspace dictionary', () => {
  const tabs = ['chat', 'code', 'preview', 'terminal', 'tasks', 'changes'] as const;
  const statuses = [
    'queued',
    'running',
    'awaitingApproval',
    'succeeded',
    'failed',
    'cancelled',
  ] as const;

  it('resolves every workspace tab in both locales', () => {
    for (const locale of ['en', 'ru'] as const) {
      const t = createTranslator(locale);
      for (const tab of tabs) {
        const rendered = t(`workspace.tabs.${tab}`);
        expect(rendered, `${locale} workspace.tabs.${tab}`).not.toMatch(/^workspace\./);
        expect(rendered.length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every run status in both locales', () => {
    for (const locale of ['en', 'ru'] as const) {
      const t = createTranslator(locale);
      for (const status of statuses) {
        const rendered = t(`workspace.runStatus.${status}`);
        expect(rendered, `${locale} workspace.runStatus.${status}`).not.toMatch(/^workspace\./);
      }
    }
  });

  it('keeps the Russian run-status copy distinct from English', () => {
    const ru = getDictionary('ru');
    expect(ru.workspace.runStatus.succeeded).toBe('Готово');
    expect(ru.workspace.tabs.changes).toBe('Изменения');
  });
});
