import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS, SETTING_KEYS } from '@/lib/settings';
import { ADMIN_SETTING_SEEDS } from '@/lib/db/seed-data/admin-settings';

/**
 * The admin console and the code must be talking about the same rows.
 *
 * They were not. The seed wrote 54 settings in snake_case
 * (`billing.minimum_topup_micro_usd`, `general.maintenance_mode`, …) while
 * `SETTING_KEYS` looked up camelCase names (`billing.minTopupMicroUsd`,
 * `platform.maintenanceMode`, …). `getSetting` matches the key exactly, so not
 * one lookup ever found its row: every call returned its compiled fallback, and
 * every switch in `/admin/settings` wrote to a row nothing read. Verified
 * against a live database — 56 rows, zero overlap with the 16 keys the code
 * asks for.
 *
 * Two independent failures had to line up for that to stay invisible: a name
 * that never matched, and a fallback that always looked plausible. These tests
 * remove the first, and the value comparison removes the second — a shipped
 * default that disagrees with the row an operator sees is the same lie in
 * slower motion.
 */

const seeded = new Map(ADMIN_SETTING_SEEDS.map((s) => [s.key, s]));

describe('admin settings wiring', () => {
  it('has a seeded row for every key the code reads', () => {
    const orphans = Object.entries(SETTING_KEYS)
      .filter(([, key]) => !seeded.has(key))
      .map(([name, key]) => `${name} -> ${key}`);

    expect(
      orphans,
      'These settings name a row the seed never creates. `PATCH /api/admin/settings` refuses to ' +
        'mint a row, so the operator has no way to change them and the code will serve its ' +
        'compiled fallback forever:\n  ' +
        orphans.join('\n  '),
    ).toEqual([]);
  });

  it('ships the same value in the seed as in the compiled fallback', () => {
    const drift: string[] = [];

    for (const key of Object.values(SETTING_KEYS)) {
      const row = seeded.get(key);
      if (!row) continue;
      const compiled = SETTING_DEFAULTS[key];
      if (row.value !== compiled) {
        drift.push(
          `${key}: seed=${JSON.stringify(row.value)} compiled=${JSON.stringify(compiled)}`,
        );
      }
    }

    expect(
      drift,
      'A fresh install would behave differently depending on whether the seed had run:\n  ' +
        drift.join('\n  '),
    ).toEqual([]);
  });

  it('declares a fallback for every key, so no lookup can return undefined', () => {
    const missing = Object.values(SETTING_KEYS).filter((key) => !(key in SETTING_DEFAULTS));
    expect(missing).toEqual([]);
  });

  it('no longer looks up any key under the camelCase names that never existed', () => {
    // The seed's whole vocabulary is snake_case. A camelCase segment here means
    // someone has invented a name again rather than pointing at a real row.
    const camel = Object.entries(SETTING_KEYS).filter(([, key]) => /[a-z][A-Z]/.test(key));
    expect(camel.map(([name, key]) => `${name} -> ${key}`)).toEqual([]);
  });

  it('keeps the admin page honest about which file reads each row', () => {
    const page = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'src',
        'app',
        'admin',
        'settings',
        'page.tsx',
      ),
      'utf8',
    );

    // Every key the code reads should be attributed on the page, otherwise an
    // operator cannot tell a live control from a decorative one.
    const unattributed = Object.values(SETTING_KEYS).filter(
      (key) => !page.includes(`'${key}'`),
    );
    expect(
      unattributed,
      `Live settings with no entry in the page's READ_BY map: ${unattributed.join(', ')}`,
    ).toEqual([]);
  });
});
