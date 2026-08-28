'use client';

import hljs from 'highlight.js/lib/common';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { CopyButton } from './copy-button';

export interface CodeBlockProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  code: string;
  /** highlight.js language id. Omitted or unknown falls back to auto-detection. */
  language?: string;
  /** Renders the header bar with the path and a copy button. */
  filename?: string;
  showLineNumbers?: boolean;
  /** Number (px) or any CSS length. Content scrolls beyond it. */
  maxHeight?: number | string;
  copyable?: boolean;
}

export function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = false,
  maxHeight,
  copyable = true,
  className,
  ...props
}: CodeBlockProps) {
  // highlight.js is synchronous and deterministic, so highlighting is pure
  // derived state — no effect, and SSR and the client produce byte-identical
  // markup, which means no hydration mismatch and no unstyled flash.
  const highlighted = React.useMemo(() => {
    try {
      const result =
        language && hljs.getLanguage(language)
          ? hljs.highlight(code, { language, ignoreIllegals: true })
          : hljs.highlightAuto(code);
      return result.value;
    } catch {
      // Unknown grammar or pathological input — plain text is a fine result.
      return null;
    }
  }, [code, language]);

  const lines = React.useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  const showHeader = Boolean(filename);
  const scrollStyle: React.CSSProperties | undefined =
    maxHeight === undefined
      ? undefined
      : { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight };

  return (
    <div
      data-slot="code-block"
      className={cn('overflow-hidden rounded-md border border-line bg-bg-inset', className)}
      {...props}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[11px] text-muted">{filename}</span>
            {language ? (
              <span className="shrink-0 rounded-sm border border-line bg-surface px-1 py-px font-mono text-[10px] tracking-wide text-subtle uppercase">
                {language}
              </span>
            ) : null}
          </div>
          {copyable ? <CopyButton value={code} size="icon-sm" /> : null}
        </div>
      ) : null}

      <div className="relative">
        <div className="overflow-auto" style={scrollStyle}>
          <div className="flex min-h-full w-max min-w-full">
            {showLineNumbers ? (
              <div
                aria-hidden="true"
                className="sticky left-0 z-10 shrink-0 border-r border-line bg-bg-inset py-3 pr-2 pl-3 text-right font-mono text-[12.5px] leading-[1.55] text-subtle select-none"
              >
                {lines.map((_, index) => (
                  <span key={index} className="block">
                    {index + 1}
                  </span>
                ))}
              </div>
            ) : null}
            <pre className="min-w-0 flex-1 px-3 py-3 font-mono text-[12.5px] leading-[1.55]">
              {highlighted === null ? (
                <code className="hljs">{code}</code>
              ) : (
                <code
                  className={cn('hljs', language && `language-${language}`)}
                  // highlight.js escapes every text node it emits.
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              )}
            </pre>
          </div>
        </div>

        {!showHeader && copyable ? (
          <CopyButton
            value={code}
            size="icon-sm"
            className="absolute top-1.5 right-1.5 bg-bg-inset/80 backdrop-blur-sm"
          />
        ) : null}
      </div>
    </div>
  );
}
