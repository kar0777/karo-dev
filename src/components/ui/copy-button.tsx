'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { Button, type ButtonProps } from './button';

/** Clipboard API needs a secure context; fall back so http:// previews still copy. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export interface CopyButtonProps extends Omit<ButtonProps, 'children' | 'onClick' | 'value'> {
  value: string;
  /** Visible text beside the icon. Omit for an icon-only button. */
  label?: React.ReactNode;
  copiedLabel?: string;
  onCopied?: (value: string) => void;
}

export function CopyButton({
  value,
  label,
  copiedLabel = 'Copied',
  onCopied,
  variant = 'ghost',
  size,
  className,
  title,
  ...props
}: CopyButtonProps) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = React.useCallback(async () => {
    const copied = await writeToClipboard(value);
    setState(copied ? 'copied' : 'failed');
    if (copied) onCopied?.(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }, [onCopied, value]);

  const resolvedSize = size ?? (label ? 'sm' : 'icon-sm');
  const accessibleLabel =
    state === 'copied'
      ? copiedLabel
      : state === 'failed'
        ? "Couldn't copy — select the text and press Ctrl+C"
        : 'Copy to clipboard';

  return (
    <Button
      variant={variant}
      size={resolvedSize}
      onClick={handleCopy}
      aria-label={label ? undefined : accessibleLabel}
      title={title ?? accessibleLabel}
      data-state={state}
      className={cn(state === 'copied' && 'text-primary hover:text-primary', className)}
      iconLeft={
        state === 'copied' ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )
      }
      {...props}
    >
      {label ? (state === 'copied' ? copiedLabel : label) : null}
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </Button>
  );
}
