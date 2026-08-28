'use client';

import { useTheme } from 'next-themes';
import type * as React from 'react';
import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner';

export { toast };
export type { ToasterProps };

/**
 * Karo-styled sonner host. Mount once, in the root layout.
 * Rich colors are off on purpose — tone comes from our own tokens so a toast
 * never introduces a color the rest of the product does not use.
 */
export function Toaster({ position = 'bottom-right', ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position={position}
      richColors={false}
      gap={8}
      offset={16}
      visibleToasts={4}
      style={
        {
          '--normal-bg': 'var(--k-surface-1)',
          '--normal-text': 'var(--k-fg)',
          '--normal-border': 'var(--k-border)',
          '--border-radius': 'var(--k-radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-md !border-line !bg-surface !text-fg !shadow-pop !text-[13px] !gap-2.5 !p-3',
          title: '!text-[13px] !font-medium !text-fg',
          description: '!text-[12.5px] !text-muted',
          icon: 'group-data-[type=error]:text-danger group-data-[type=success]:text-primary group-data-[type=warning]:text-warning group-data-[type=info]:text-info',
          actionButton:
            '!h-7 !rounded-md !bg-primary !px-2.5 !text-[12px] !font-medium !text-primary-fg',
          cancelButton:
            '!h-7 !rounded-md !bg-surface-2 !px-2.5 !text-[12px] !font-medium !text-muted',
          closeButton: '!border-line !bg-surface-2 !text-muted hover:!text-fg',
        },
      }}
      {...props}
    />
  );
}
