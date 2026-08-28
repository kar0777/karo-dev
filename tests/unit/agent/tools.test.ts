import { describe, expect, it } from 'vitest';

import {
  compileSearchPattern,
  MAX_SEARCH_PATTERN_CHARS,
  scanForMatches,
} from '@/lib/agent/tools';

function regexOf(query: string): RegExp {
  const compiled = compileSearchPattern(query);
  if ('error' in compiled) throw new Error(`expected ${query} to compile: ${compiled.error}`);
  return compiled.regex;
}

function errorOf(query: string): string {
  const compiled = compileSearchPattern(query);
  if (!('error' in compiled)) throw new Error(`expected ${query} to be refused`);
  return compiled.error;
}

describe('compileSearchPattern', () => {
  it('compiles the patterns an agent actually searches with', () => {
    expect(regexOf('function\\s+handler').test('export function handler() {')).toBe(true);
    expect(regexOf('TODO|FIXME').test('// fixme: later')).toBe(true);
    expect(regexOf('^import .* from').test("import { db } from '@/lib/db';")).toBe(true);
  });

  it('refuses a repeat applied to a group that already repeats', () => {
    for (const pattern of ['(a+)+', '(a*)*$', '(?:\\d+)+', '((x+))+', '(ab{2,})+']) {
      expect(errorOf(pattern)).toContain('exponential time');
    }
  });

  it('does not mistake an escaped or bracketed parenthesis for a group', () => {
    expect(regexOf('\\(a+\\)+').test('(aaa))')).toBe(true);
    expect(regexOf('[(+)]+').test('((+')).toBe(true);
  });

  it('refuses a pattern past the length cap', () => {
    const long = 'needle|'.repeat(MAX_SEARCH_PATTERN_CHARS);
    expect(errorOf(long)).toContain(String(MAX_SEARCH_PATTERN_CHARS));
  });

  it('still reports a pattern the engine cannot parse', () => {
    expect(errorOf('(unclosed')).toContain('Invalid regular expression');
  });
});

describe('scanForMatches', () => {
  const files = Array.from({ length: 50 }, (_, n) => ({
    path: `src/file-${n}.ts`,
    content: 'const needle = 1;\nconst other = 2;\n',
  }));

  it('reports every match with its path and one-based line number', () => {
    const result = scanForMatches(files.slice(0, 2), regexOf('needle'));
    expect(result.timedOut).toBe(false);
    expect(result.hits).toEqual([
      'src/file-0.ts:1: const needle = 1;',
      'src/file-1.ts:1: const needle = 1;',
    ]);
  });

  it('stops at the hit cap without calling it a timeout', () => {
    const result = scanForMatches(files, regexOf('const'), { maxHits: 3 });
    expect(result.hits).toHaveLength(3);
    expect(result.timedOut).toBe(false);
  });

  it('abandons the scan once the wall-clock budget is spent, keeping what it found', () => {
    // An injected clock advancing 10 ms per reading: the first reading sets the
    // deadline, so a 50 ms budget allows four line checks and then gives up —
    // long before the fiftieth file.
    let reading = 0;
    const result = scanForMatches(files, regexOf('needle'), {
      budgetMs: 50,
      now: () => reading++ * 10,
    });

    expect(result.timedOut).toBe(true);
    expect(result.hits[0]).toBe('src/file-0.ts:1: const needle = 1;');
    expect(result.hits.length).toBeLessThan(files.length);
  });
});
