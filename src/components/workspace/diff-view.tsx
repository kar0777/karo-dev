'use client';

import hljs from 'highlight.js/lib/common';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { parseUnifiedDiff, type DiffLine } from './diff';
import { languageForPath } from './icons';

/**
 * Unified-diff renderer.
 *
 * Rendering is capped at `INITIAL_LINES` because a 40k-line patch in a chat
 * bubble is a hang, not a feature — the rest is one click away.
 */

const INITIAL_LINES = 320;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightLine(text: string, language: string | null): string {
  if (!text) return '&nbsp;';
  if (!language || !hljs.getLanguage(language)) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

const MARKER: Record<DiffLine['kind'], string> = {
  add: '+',
  del: '−',
  context: ' ',
  meta: ' ',
};

export function DiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      className={cn('karo-numeric inline-flex items-center gap-1.5 text-[11px]', className)}
    >
      <span className="text-success">+{additions}</span>
      <span className="text-danger">−{deletions}</span>
    </span>
  );
}

export function DiffView({
  patch,
  path,
  className,
  maxHeight = 420,
}: {
  patch: string;
  path?: string;
  className?: string;
  maxHeight?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const parsed = React.useMemo(() => parseUnifiedDiff(patch), [patch]);
  const language = React.useMemo(() => (path ? languageForPath(path) : null), [path]);

  const rows = React.useMemo(() => {
    const flat: Array<{ hunk: string | null; line: DiffLine; key: string }> = [];
    parsed.hunks.forEach((hunk, hunkIndex) => {
      flat.push({
        hunk: hunk.header,
        line: { kind: 'meta', text: hunk.header, oldLine: null, newLine: null },
        key: `h${hunkIndex}`,
      });
      hunk.lines.forEach((line, lineIndex) => {
        flat.push({ hunk: null, line, key: `h${hunkIndex}l${lineIndex}` });
      });
    });
    return flat;
  }, [parsed.hunks]);

  if (!patch.trim()) {
    return (
      <p className={cn('px-3 py-2.5 text-[12px] text-muted', className)}>
        No textual diff is available for this change — the file is binary or was renamed only.
      </p>
    );
  }

  const visible = expanded ? rows : rows.slice(0, INITIAL_LINES);
  const hidden = rows.length - visible.length;

  return (
    <div className={cn('overflow-hidden rounded-md border border-line bg-bg-inset', className)}>
      <div
        className="overflow-auto font-mono text-[11.5px] leading-[1.55]"
        style={{ maxHeight: expanded ? undefined : maxHeight }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {visible.map(({ line, key, hunk }) => {
              if (hunk !== null) {
                return (
                  <tr key={key} className="bg-surface-2/70">
                    <td
                      colSpan={3}
                      className="px-2 py-0.5 text-[10.5px] tracking-wide text-subtle select-none"
                    >
                      {hunk}
                    </td>
                  </tr>
                );
              }
              return (
                <tr
                  key={key}
                  className={cn(
                    line.kind === 'add' && 'bg-success-soft',
                    line.kind === 'del' && 'bg-danger-soft',
                  )}
                >
                  <td className="w-10 border-r border-line/60 px-1.5 text-right align-top text-subtle tabular-nums select-none">
                    {line.oldLine ?? ''}
                  </td>
                  <td className="w-10 border-r border-line/60 px-1.5 text-right align-top text-subtle tabular-nums select-none">
                    {line.newLine ?? ''}
                  </td>
                  <td className="w-full px-2 align-top whitespace-pre-wrap">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mr-1.5 inline-block w-2 select-none',
                        line.kind === 'add' && 'text-success',
                        line.kind === 'del' && 'text-danger',
                        line.kind !== 'add' && line.kind !== 'del' && 'text-subtle',
                      )}
                    >
                      {MARKER[line.kind]}
                    </span>
                    <span
                      className="hljs"
                      // hljs escapes its input; `escapeHtml` covers the plain path.
                      dangerouslySetInnerHTML={{ __html: highlightLine(line.text, language) }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <div className="border-t border-line bg-surface-2 px-2 py-1.5">
          <Button variant="ghost" size="xs" onClick={() => setExpanded(true)}>
            Show {hidden} more lines
          </Button>
        </div>
      ) : null}
    </div>
  );
}
