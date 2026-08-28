'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * OAuth, rendered honestly.
 *
 * The `accounts` table, the provider link columns and the callback shape all
 * exist — what does not exist is a configured identity provider, and pretending
 * otherwise by showing a button that errors on click would be worse than showing
 * nothing. So the buttons are disabled, labelled, and explained in visible text
 * rather than in a hover-only tooltip: a keyboard user gets the same answer as a
 * mouse user.
 */

const UNAVAILABLE = 'OAuth is architected but not enabled in this deployment.';

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  // Google's mark is four fixed colours by brand rule, so this is one of the very
  // few places in Karo that is not token-driven.
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

const PROVIDERS = [
  { key: 'github', label: 'Continue with GitHub', Mark: GitHubMark },
  { key: 'google', label: 'Continue with Google', Mark: GoogleMark },
] as const;

export function OAuthButtons({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map(({ key, label, Mark }) => (
          <Tooltip key={key}>
            {/* A disabled button receives no pointer events, so the trigger is the
                wrapper around it. */}
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="secondary"
                  size="lg"
                  disabled
                  className="w-full"
                  iconLeft={<Mark className="size-4" />}
                >
                  {label}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{UNAVAILABLE}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-subtle">{UNAVAILABLE}</p>
    </div>
  );
}
