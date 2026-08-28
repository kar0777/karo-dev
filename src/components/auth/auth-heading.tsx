import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The heading block every auth screen opens with. Server-rendered so the page
 * title is in the initial HTML — a sign-in screen that shows nothing until
 * JavaScript arrives is a bad first impression of a product about machines.
 */
export function AuthHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('space-y-1.5', className)}>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
      {description ? (
        <p className="text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
    </header>
  );
}
