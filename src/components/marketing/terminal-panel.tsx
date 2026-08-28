import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Static terminal panel
 *
 *  A non-interactive rendering of the sandbox shell for marketing
 *  sections. Purely presentational: no state, no animation beyond the
 *  caret, and the whole block is exposed to assistive tech as a single
 *  labelled region rather than dozens of unreadable fragments.
 * ------------------------------------------------------------------ */

export type TerminalLineKind = 'cmd' | 'out' | 'ok' | 'warn' | 'err' | 'dim';

export type TerminalLine = { kind: TerminalLineKind; text: string };

const TONE: Record<TerminalLineKind, string> = {
  cmd: 'text-term-fg',
  out: 'text-term-fg/80',
  ok: 'text-primary',
  warn: 'text-warning',
  err: 'text-danger',
  dim: 'text-term-fg/45',
};

export interface TerminalPanelProps {
  lines: readonly TerminalLine[];
  /** Shown in the title bar. Defaults to the sandbox shell identity. */
  title?: string;
  prompt?: string;
  /** Accessible summary — screen readers get this instead of the ASCII. */
  label: string;
  caret?: boolean;
  className?: string;
}

export function TerminalPanel({
  lines,
  title = 'bash — sb-3f9a',
  prompt = 'karo@sandbox:/workspace$',
  label,
  caret = true,
  className,
}: TerminalPanelProps) {
  return (
    <figure
      className={cn('overflow-hidden rounded-lg border border-line shadow-md', className)}
    >
      <figcaption className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-primary/70" />
        </span>
        <span className="truncate font-mono text-[11px] text-muted">{title}</span>
      </figcaption>

      <div
        role="img"
        aria-label={label}
        className="karo-no-scrollbar overflow-x-auto bg-term-bg px-3.5 py-3 font-mono text-[12px] leading-[1.7]"
      >
        {lines.map((line, index) => (
          <div key={index} className={cn('whitespace-pre', TONE[line.kind])}>
            {line.kind === 'cmd' ? (
              <>
                <span className="text-primary">{prompt.split(':')[0]}</span>
                <span className="text-term-fg/45">
                  :{prompt.split(':').slice(1).join(':')}{' '}
                </span>
                {line.text}
              </>
            ) : (
              line.text || ' '
            )}
          </div>
        ))}
        {caret ? (
          <div className="flex items-center gap-1 whitespace-pre text-term-fg/60">
            <span className="text-primary">{prompt.split(':')[0]}</span>
            <span className="text-term-fg/45">:{prompt.split(':').slice(1).join(':')}</span>
            <span
              className="inline-block h-3.5 w-2 animate-caret bg-term-fg/70"
              aria-hidden="true"
            />
          </div>
        ) : null}
      </div>
    </figure>
  );
}
