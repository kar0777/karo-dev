/**
 * Unified-diff parsing for the review surfaces.
 *
 * Patches are produced on the server (`createTwoFilesPatch`), so the browser
 * only ever has to read them. Anything it cannot parse is surfaced as a single
 * plain block rather than being dropped — a diff the user cannot see is worse
 * than an ugly one.
 */

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type ParsedDiff = {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** True when the patch had no `@@` hunk at all (binary or unparseable). */
  unstructured: boolean;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(patch: string): ParsedDiff {
  const source = patch ?? '';
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of source.split('\n')) {
    const match = HUNK_HEADER.exec(raw);
    if (match) {
      current = { header: (match[5] ?? '').trim() || raw, lines: [] };
      hunks.push(current);
      oldLine = Number.parseInt(match[1] ?? '1', 10);
      newLine = Number.parseInt(match[3] ?? '1', 10);
      continue;
    }
    if (!current) continue;

    // `\ No newline at end of file` is metadata, not content.
    if (raw.startsWith('\\')) {
      current.lines.push({
        kind: 'meta',
        text: raw.slice(1).trim(),
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    const marker = raw.charAt(0);
    const text = raw.slice(1);

    if (marker === '+') {
      additions += 1;
      current.lines.push({ kind: 'add', text, oldLine: null, newLine });
      newLine += 1;
    } else if (marker === '-') {
      deletions += 1;
      current.lines.push({ kind: 'del', text, oldLine, newLine: null });
      oldLine += 1;
    } else if (marker === ' ' || raw === '') {
      current.lines.push({ kind: 'context', text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  if (hunks.length === 0 && source.trim()) {
    return {
      hunks: [
        {
          header: 'Full contents',
          lines: source
            .split('\n')
            .map((text) => ({ kind: 'context' as const, text, oldLine: null, newLine: null })),
        },
      ],
      additions: 0,
      deletions: 0,
      unstructured: true,
    };
  }

  return { hunks, additions, deletions, unstructured: false };
}

/** Cheap +/− counts without building the whole line model. */
export function countDiffLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of (patch ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}
