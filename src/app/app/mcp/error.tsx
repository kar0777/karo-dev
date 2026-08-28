'use client';

import { ExtensionsPageError } from '@/components/extensions/page-error';

export default function McpError({
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
      boundary="mcp"
      subject="your MCP servers"
      hint="The list could not be read from the database. Your servers and their credentials are untouched — try again, and if it keeps failing check the platform status page."
    />
  );
}
