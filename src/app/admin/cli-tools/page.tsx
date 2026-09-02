import { asc } from 'drizzle-orm';

import { CliToolsTable, type AdminCliToolRow } from '@/components/admin/cli-tools-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { cliTools } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * `/admin/cli-tools` — the installable CLI agent catalogue.
 *
 * Authorisation runs here, not only in the layout: each admin page proves the
 * caller itself, because a layout is not a security boundary in the App Router.
 */
export default async function AdminCliToolsPage() {
  await requirePlatformAdmin();

  const rows = await db
    .select()
    .from(cliTools)
    .orderBy(asc(cliTools.sortOrder), asc(cliTools.name));

  const tools: AdminCliToolRow[] = rows.map((tool) => ({
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    vendor: tool.vendor,
    description: tool.description,
    license: tool.license,
    licenseKind: tool.licenseKind,
    licenseUrl: tool.licenseUrl,
    docsUrl: tool.docsUrl,
    authKind: tool.authKind,
    authNote: tool.authNote,
    apiKeyEnvVar: tool.apiKeyEnvVar,
    apiKeyProviderKey: tool.apiKeyProviderKey,
    binName: tool.binName,
    versionArg: tool.versionArg,
    installCommands: tool.installCommands,
    launchCommand: tool.launchCommand,
    isEnabled: tool.isEnabled,
    sortOrder: tool.sortOrder,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="CLI agents"
        description="Terminal coding agents users can install into a sandbox or on their own machine. Install commands are the vendors' own; toggling a tool off hides it platform-wide without a deploy."
      />

      {tools.length === 0 ? (
        <EmptyState
          title="No CLI tools in the catalogue"
          description="Run `npm run db:seed` to install the default catalogue (Claude Code, Codex, Gemini CLI, Aider, OpenCode, Crush, Qwen Code, Goose), or add a tool by hand."
        />
      ) : (
        <CliToolsTable tools={tools} />
      )}
    </div>
  );
}
