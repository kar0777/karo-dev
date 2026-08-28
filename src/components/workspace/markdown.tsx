'use client';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

/**
 * Assistant markdown.
 *
 * `rehype-highlight` rewrites code content into nested `<span>`s, so the copy
 * button recovers the original text by walking the rendered React tree rather
 * than reading a string prop that no longer exists.
 */

function reactText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return reactText(props.children);
  }
  return '';
}

function languageOf(node: React.ReactNode): string | null {
  const child = React.Children.toArray(node).find((item) => React.isValidElement(item));
  if (!child || !React.isValidElement(child)) return null;
  const props = child.props as { className?: string };
  const match = /language-([\w+-]+)/.exec(props.className ?? '');
  return match?.[1] ?? null;
}

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  javascript: 'JavaScript',
  json: 'JSON',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  css: 'CSS',
  html: 'HTML',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  diff: 'Diff',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
};

function CodeSurface({ children }: { children: React.ReactNode }) {
  const code = reactText(children);
  const language = languageOf(children);
  const label = language ? (LANGUAGE_LABELS[language] ?? language) : 'Code';

  return (
    <div className="not-prose my-3 overflow-hidden rounded-md border border-line bg-bg-inset">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-2.5 py-1">
        <span className="font-mono text-[10.5px] tracking-wide text-subtle uppercase">
          {label}
        </span>
        <CopyButton value={code} size="icon-sm" />
      </div>
      <pre className="!m-0 !rounded-none !border-0 overflow-x-auto px-3 py-2.5 text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const COMPONENTS: Components = {
  pre: ({ children }) => <CodeSurface>{children}</CodeSurface>,
  a: ({ children, href, ...rest }) => (
    <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children, ...rest }) => (
    <div className="overflow-x-auto">
      <table {...rest}>{children}</table>
    </div>
  ),
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

export const Markdown = React.memo(function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('karo-prose text-[13.5px] leading-[1.65]', className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
