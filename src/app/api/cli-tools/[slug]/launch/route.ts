import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { openTerminalSession } from '@/app/api/_shared/terminal-open';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created } from '@/lib/api/responses';
import {
  buildLaunchScript,
  cliScriptPath,
  getCliToolBySlug,
  resolveVaultKey,
} from '@/lib/cli-tools/service';
import { rehydrateProvider } from '@/lib/sandbox/service';

/**
 * `POST /api/cli-tools/[slug]/launch` — open a terminal ready to run the tool.
 *
 * Server side this writes a `0600` launcher script into the sandbox (embedding
 * the user's own vault key when asked, decrypted and never echoed back) and
 * opens a terminal session titled after the tool. The client then types the
 * script path into that terminal, exactly as a user would — so OAuth tools
 * (`claude`, `codex`, `gemini`) run their interactive login flow in a real PTY
 * and nothing secret ever crosses the browser or the terminal history.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sandboxId: z.string().min(1).max(64),
  attachKey: z.boolean().optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'api.default', body: bodySchema },
  async ({ params, body, user }) => {
    const tool = await getCliToolBySlug(routeParam(params, 'slug'));
    const access = await requireSandboxAccess(body.sandboxId, 'terminal.use');

    if (access.sandbox.status !== 'running') {
      throw new ConflictError(`The sandbox is ${access.sandbox.status}.`, {
        title: 'Sandbox is not running',
        description: 'Start the sandbox, then launch the tool.',
        details: { status: access.sandbox.status },
      });
    }

    const apiKey = await resolveVaultKey(tool, user, body.attachKey === true);
    if (body.attachKey === true && tool.authKind === 'api_key' && !apiKey) {
      // Asked for the vault but nothing usable there — say so instead of
      // launching a tool that will die on its first API call.
      const hasProviderKey = Boolean(tool.apiKeyProviderKey);
      throw new ConflictError(
        hasProviderKey
          ? `No active ${tool.apiKeyProviderKey} key in your vault.`
          : 'No matching API key in your vault.',
        {
          title: 'No API key found',
          description: hasProviderKey
            ? 'Add one on the API keys page, or launch without attaching and authenticate inside the terminal.'
            : `${tool.name} reads the key of whichever model provider you use. Launch without attaching and export the key in the terminal, e.g. ${tool.apiKeyEnvVar ? `export ${tool.apiKeyEnvVar}=…` : 'export OPENAI_API_KEY=…'}.`,
          details: { providerKey: tool.apiKeyProviderKey ?? null },
        },
      );
    }

    const provider = rehydrateProvider(access.sandbox);
    await provider.uploadFiles(access.sandbox.id, [
      {
        path: cliScriptPath(tool.slug),
        content: buildLaunchScript(tool, apiKey),
        mode: 0o600,
      },
    ]);

    const session = await openTerminalSession({
      sandbox: access.sandbox,
      project: access.project,
      user,
      shell: 'bash',
      title: tool.name,
      cols: body.cols ?? 100,
      rows: body.rows ?? 28,
      cwd: '/workspace',
    });

    return created({
      sessionId: session.id,
      command: `bash ${cliScriptPath(tool.slug)}`,
      authNote: tool.authNote,
    });
  },
);
