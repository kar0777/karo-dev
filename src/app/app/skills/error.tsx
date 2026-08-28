'use client';

import { ExtensionsPageError } from '@/components/extensions/page-error';

export default function SkillsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ExtensionsPageError
      error={error}
      reset={reset}
      boundary="skills"
      subject="the skill catalogue"
      hint="Your installed skills are unaffected — only this page failed to render. Try again, and if the problem persists your agent runs will still load the skills they already have."
    />
  );
}
