import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nothing a browser loads may reach server-side code.
 *
 * `src/lib/crypto/password.ts` mixed scrypt hashing with the password-strength
 * rules, and its own comment called those rules "shared by the client meter and
 * the server-side registration validator" — but the two halves were never
 * separated. Every auth form imported the shared half and got `node:crypto` with
 * it. The module calls `promisify(scrypt)` at module scope, and in a browser
 * bundle `crypto.scrypt` is an empty shim, so evaluation threw
 * `The "original" argument must be of type Function` and the entire sign-in
 * screen died on hydration.
 *
 * `next build` did not catch it, because Turbopack politely polyfills Node
 * builtins for the browser. Neither did any status-code or HTML assertion: the
 * server-rendered markup was perfect, and the crash happened afterwards, in the
 * client. It took someone opening the page to find it.
 *
 * So the boundary is checked here instead, statically and on every run. Type-only
 * imports are ignored because they are erased; string literals are stripped first
 * because the marketing demo renders fake `import` lines as content.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

const NODE_BUILTIN =
  /^(node:)?(fs|path|crypto|util|os|net|tls|http|https|stream|zlib|child_process|worker_threads|dns|dgram|cluster|readline|repl|v8|vm|perf_hooks|async_hooks|inspector)(\/|$)/;

/** Packages that only make sense on a server; each drags a Node builtin with it. */
const SERVER_PACKAGE =
  /^(postgres|drizzle-orm\/postgres-js|stripe|dockerode|ioredis|nodemailer|dotenv|@daytonaio|server-only)$/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * Blanks out literals that sit in a value position (`text: 'import x from "y"'`)
 * so quoted sample code is not mistaken for a real import. The marketing demo
 * renders fake `import` lines as content, which is otherwise a false positive.
 * Literals following `from` are left intact — those are the actual specifiers.
 */
function withoutLiterals(source: string): string {
  return source
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/(:\s*)'(?:[^'\\\n]|\\.)*'/g, "$1''")
    .replace(/(:\s*)"(?:[^"\\\n]|\\.)*"/g, '$1""');
}

/** Value imports only — `import type` and all-type named clauses are erased at build. */
function valueImports(source: string): string[] {
  const cleaned = withoutLiterals(source);
  const out: string[] = [];

  for (const m of cleaned.matchAll(/import\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = (m[1] ?? '').trim();
    if (clause.startsWith('type ')) continue;
    const named = clause.match(/\{([^}]*)\}/);
    if (named && !clause.replace(named[0], '').replace(/[\s,]/g, '')) {
      const specs = (named[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (specs.length > 0 && specs.every((s) => s.startsWith('type '))) continue;
    }
    out.push(m[2]!);
  }
  for (const m of cleaned.matchAll(/import\s+['"]([^'"]+)['"]/g)) out.push(m[1]!);

  return out;
}

describe('client bundle boundary', () => {
  const files = sourceFiles(SRC);
  const read = (f: string) => readFileSync(f, 'utf8');

  const resolveSpec = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else return null;
    for (const candidate of [
      base + '.ts',
      base + '.tsx',
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ]) {
      if (files.includes(candidate)) return candidate;
    }
    return null;
  };

  const clientEntries = files.filter((f) =>
    /^\s*['"]use client['"]/m.test(read(f).slice(0, 400)),
  );

  it('finds the client components', () => {
    expect(clientEntries.length).toBeGreaterThan(50);
  });

  it('never reaches a Node builtin or a server-only module from a client component', () => {
    const leaks: string[] = [];
    const rel = (p: string) => p.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');

    for (const entry of clientEntries) {
      const seen = new Set<string>();
      const stack: Array<[string, string[]]> = [[entry, [entry]]];

      while (stack.length > 0) {
        const next = stack.pop();
        if (!next) break;
        const [file, path] = next;
        if (seen.has(file)) continue;
        seen.add(file);

        for (const spec of valueImports(read(file))) {
          if (NODE_BUILTIN.test(spec) || SERVER_PACKAGE.test(spec)) {
            leaks.push(`${spec}\n      ${path.map(rel).join('\n   -> ')}`);
            continue;
          }
          const target = resolveSpec(spec, file);
          if (target) stack.push([target, [...path, target]]);
        }
      }
    }

    expect(
      leaks,
      'These imports put server-side code in a browser bundle. It builds — Turbopack shims the ' +
        'builtin — and then throws while the module evaluates, taking the whole screen down after ' +
        'the HTML has already rendered. Split the isomorphic half into its own module:\n\n  ' +
        leaks.join('\n\n  '),
    ).toEqual([]);
  });
});
