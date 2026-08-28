import { z } from 'zod';

/**
 * Input schemas for the MCP / skills / plugins API surface.
 *
 * They live outside the route files because two of them are also used on the
 * client: the skill import dialog validates a pasted document before it is
 * uploaded, so a malformed file is rejected with field-level errors instead of
 * a round trip that returns a 400.
 */

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/* ------------------------------------------------------------------ *
 *  MCP
 * ------------------------------------------------------------------ */

export const mcpEnvEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Give the variable a name.')
    .max(128)
    .regex(
      ENV_KEY,
      'Use letters, digits and underscores, starting with a letter or underscore.',
    ),
  value: z.string().max(8192),
  secret: z.boolean(),
});

export const mcpHeaderEntrySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the header a name.')
    .max(128)
    .regex(HEADER_NAME, 'Header names may contain letters, digits and hyphens.'),
  value: z.string().max(8192),
  secret: z.boolean(),
});

const mcpBase = {
  name: z.string().trim().min(1, 'Name the server.').max(80),
  description: z.string().trim().max(400).default(''),
  scope: z.enum(['account', 'project']).default('account'),
  projectId: z.string().min(1).nullable().default(null),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: z.string().trim().max(400).nullable().default(null),
  args: z.array(z.string().max(400)).max(64).default([]),
  url: z.string().trim().max(2048).nullable().default(null),
  env: z.array(mcpEnvEntrySchema).max(64).default([]),
  headers: z.array(mcpHeaderEntrySchema).max(32).default([]),
  allowedTools: z.array(z.string().max(200)).max(256).default([]),
  requireApproval: z.boolean().default(true),
  isEnabled: z.boolean().default(true),
  templateKey: z.string().max(64).nullable().default(null),
};

/** stdio needs a command; the remote transports need a URL. */
function refineTransport(
  value: { transport: string; command?: string | null; url?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.transport === 'stdio') {
    if (!value.command || value.command.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'A stdio server needs the command that starts it, e.g. `npx`.',
      });
    }
    return;
  }
  if (!value.url || value.url.trim() === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'An HTTP or SSE server needs the endpoint URL.',
    });
    return;
  }
  try {
    const parsed = new URL(value.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Use an http:// or https:// URL.',
      });
    }
  } catch {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'That is not a valid URL.' });
  }
}

export const mcpCreateSchema = z.object(mcpBase).superRefine(refineTransport);

export const mcpUpdateSchema = z
  .object({
    name: mcpBase.name.optional(),
    description: z.string().trim().max(400).optional(),
    scope: z.enum(['account', 'project']).optional(),
    projectId: z.string().min(1).nullable().optional(),
    transport: z.enum(['stdio', 'http', 'sse']).optional(),
    command: z.string().trim().max(400).nullable().optional(),
    args: z.array(z.string().max(400)).max(64).optional(),
    url: z.string().trim().max(2048).nullable().optional(),
    /** Omit to keep the stored values; send an array to replace them wholesale. */
    env: z.array(mcpEnvEntrySchema).max(64).optional(),
    headers: z.array(mcpHeaderEntrySchema).max(32).optional(),
    allowedTools: z.array(z.string().max(200)).max(256).optional(),
    requireApproval: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update.',
  });

export const mcpToolPatchSchema = z.object({
  toolId: z.string().min(1),
  isEnabled: z.boolean(),
});

/* ------------------------------------------------------------------ *
 *  Skills
 * ------------------------------------------------------------------ */

export const slashCommandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the command.')
    .max(48)
    .regex(SLUG, 'Use lowercase letters, digits and hyphens.'),
  description: z.string().trim().min(1, 'Say what the command does.').max(200),
  prompt: z.string().trim().min(1, 'The command needs a prompt to send.').max(8000),
});

export const skillEnvFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Give the variable a name.')
    .max(128)
    .regex(
      ENV_KEY,
      'Use letters, digits and underscores, starting with a letter or underscore.',
    ),
  label: z.string().trim().min(1, 'Give the field a label.').max(120),
  required: z.boolean(),
  secret: z.boolean(),
  description: z.string().trim().max(400).optional(),
});

export const skillDraftSchema = z.object({
  name: z.string().trim().min(1, 'Name the skill.').max(80),
  description: z.string().trim().min(1, 'Describe what the skill does.').max(400),
  instructions: z
    .string()
    .trim()
    .min(40, 'Write at least a short paragraph — the agent reads this verbatim.')
    .max(20_000),
  icon: z.string().trim().min(1).max(48).default('sparkles'),
  category: z.string().trim().min(1).max(48).default('general'),
  version: z
    .string()
    .trim()
    .max(24)
    .regex(/^\d+\.\d+\.\d+$/, 'Use a semantic version such as 1.0.0.')
    .default('1.0.0'),
  allowedTools: z.array(z.string().max(80)).max(64).default([]),
  requiredPlugins: z.array(z.string().max(80)).max(32).default([]),
  slashCommands: z.array(slashCommandSchema).max(24).default([]),
  environmentSchema: z.array(skillEnvFieldSchema).max(32).default([]),
});

/** The shape of an exported skill file, and what `/api/skills/import` accepts. */
export const skillDocumentSchema = z.object({
  karoSkillVersion: z.literal(1).optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(SLUG, 'Use lowercase letters, digits and hyphens.')
    .optional(),
  name: skillDraftSchema.shape.name,
  description: skillDraftSchema.shape.description,
  instructions: skillDraftSchema.shape.instructions,
  version: skillDraftSchema.shape.version,
  author: z.string().trim().max(80).default('Imported'),
  icon: skillDraftSchema.shape.icon,
  category: skillDraftSchema.shape.category,
  allowedTools: skillDraftSchema.shape.allowedTools,
  requiredPlugins: skillDraftSchema.shape.requiredPlugins,
  slashCommands: skillDraftSchema.shape.slashCommands,
  environmentSchema: skillDraftSchema.shape.environmentSchema,
});

export type SkillDocument = z.infer<typeof skillDocumentSchema>;

export const skillInstallSchema = z.object({
  scope: z.enum(['account', 'project']).default('account'),
  projectId: z.string().min(1).nullable().default(null),
});

export const skillConfigureSchema = z.object({
  installationId: z.string().min(1),
  isEnabled: z.boolean().optional(),
  /** Non-secret values. Omitted keys keep their stored value. */
  config: z.record(z.string(), z.string().max(4096)).optional(),
  /** Secret values, encrypted before insert. An empty string clears the key. */
  secrets: z.record(z.string(), z.string().max(4096)).optional(),
});

export const skillUninstallSchema = z.object({
  installationId: z.string().min(1),
});

/* ------------------------------------------------------------------ *
 *  Plugins
 * ------------------------------------------------------------------ */

export const pluginInstallSchema = z.object({
  /** Every permission the plugin declares must be listed here explicitly. */
  grantedPermissions: z.array(z.string().max(80)).max(32),
  acceptedPermissions: z.literal(true, {
    message: 'Accept the permission list before installing.',
  }),
  config: z.record(z.string(), z.string().max(4096)).default({}),
  secrets: z.record(z.string(), z.string().max(4096)).default({}),
});

export const pluginConfigSchema = z.object({
  config: z.record(z.string(), z.string().max(4096)).optional(),
  secrets: z.record(z.string(), z.string().max(4096)).optional(),
  isEnabled: z.boolean().optional(),
  /** Re-runs install with the catalogue's current version. */
  upgrade: z.boolean().optional(),
});
