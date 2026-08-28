import { Cpu, FolderTree, Network, Terminal } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Isolation diagram
 *
 *  Three nested boundaries drawn with borders and labels — no image, no
 *  canvas, so it scales, respects the theme, and reads correctly when
 *  CSS fails to load. Screen readers get the same nesting as a list.
 * ------------------------------------------------------------------ */

function Layer({
  label,
  caption,
  tone,
  children,
  className,
}: {
  label: string;
  caption: string;
  tone: 'outer' | 'middle' | 'inner';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 sm:p-4',
        tone === 'outer' && 'border border-line bg-surface',
        tone === 'middle' && 'border border-dashed border-line-strong bg-surface-2',
        tone === 'inner' && 'border border-line-accent bg-primary-soft/40',
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={cn(
            'text-[11px] font-semibold tracking-[0.1em] uppercase',
            tone === 'inner' ? 'text-primary' : 'text-subtle',
          )}
        >
          {label}
        </span>
        <span className="text-[12px] text-muted">{caption}</span>
      </div>
      {children}
    </div>
  );
}

const PROCESSES = [
  { icon: FolderTree, label: '/workspace', note: 'your files' },
  { icon: Terminal, label: 'shell', note: 'bash · sh · pwsh · cmd' },
  { icon: Cpu, label: 'agent', note: 'tool loop' },
  { icon: Network, label: 'egress', note: 'policy-checked' },
] as const;

export function IsolationDiagram({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-bg-inset p-3 sm:p-4', className)}>
      <Layer
        label="Karo control plane"
        caption="Schedules work. Never runs a user command itself."
        tone="outer"
      >
        <Layer
          label="Sandbox runtime"
          caption="Rootless. No host Docker socket is ever mounted."
          tone="middle"
        >
          <Layer
            label="Your sandbox"
            caption="sb-3f9a · 0.25 vCPU · 512 MB · own PID, mount, network and user namespaces"
            tone="inner"
          >
            <ul className="grid grid-cols-2 gap-2">
              {PROCESSES.map((process) => {
                const Icon = process.icon;
                return (
                  <li
                    key={process.label}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2"
                  >
                    <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px] text-fg">
                        {process.label}
                      </span>
                      <span className="block truncate text-[10.5px] text-subtle">
                        {process.note}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Layer>
        </Layer>
      </Layer>

      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        One sandbox per project. Nothing crosses a boundary except the tool calls the agent is
        permitted to make, and every one of them is recorded.
      </p>
    </div>
  );
}
