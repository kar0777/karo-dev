import {
  SLASH_CATEGORY_ORDER,
  SLASH_COMMANDS as SLASH_COMMAND_REGISTRY,
  type SlashCommandCategory,
} from '@/components/workspace/slash-commands';

import type { AnchorGroup } from './anchor-nav';

/**
 * Documentation content that is a list rather than prose.
 *
 * Kept beside the page so the sidebar, the anchors and the tables cannot
 * drift apart: the nav is generated from the same section ids the page
 * renders.
 */

export const DOCS_NAV: readonly AnchorGroup[] = [
  {
    title: 'Getting started',
    items: [
      { id: 'quickstart', label: 'Quickstart' },
      { id: 'workspace-tour', label: 'Workspace tour' },
    ],
  },
  {
    title: 'Concepts',
    items: [
      { id: 'projects', label: 'Projects' },
      { id: 'sandboxes', label: 'Sandboxes' },
      { id: 'weighted-tokens', label: 'Weighted tokens' },
      { id: 'compute-units', label: 'Compute units' },
    ],
  },
  {
    title: 'Using the agent',
    items: [
      { id: 'agent-modes', label: 'Agent modes' },
      { id: 'slash-commands', label: 'Slash commands' },
      { id: 'terminal', label: 'Terminal' },
    ],
  },
  {
    title: 'Extending',
    items: [
      { id: 'mcp', label: 'MCP servers' },
      { id: 'skills', label: 'Skills' },
      { id: 'plugins', label: 'Plugins' },
    ],
  },
  {
    title: 'Bring your own',
    items: [
      { id: 'byok', label: 'Model keys' },
      { id: 'byos', label: 'Your own server' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'billing', label: 'Billing and usage' },
      { id: 'security', label: 'Security' },
      { id: 'api', label: 'API' },
    ],
  },
];

export type SlashCommand = {
  command: string;
  args?: string;
  group: SlashGroup;
  description: string;
};

/** The registry's own categories, so a new one appears here without an edit. */
export type SlashGroup = SlashCommandCategory;

export const SLASH_GROUPS: readonly SlashGroup[] = SLASH_CATEGORY_ORDER;

/**
 * The built-in slash commands, projected from the registry the composer
 * actually runs rather than retyped for the documentation.
 *
 * Retyping it is how a reference ends up promising `/apply`, `/export` and
 * `/cost` to a palette that has never had them while thirteen real commands go
 * unmentioned. Deriving the table means the name, the argument hint and the
 * description are the implementation's own, and adding, renaming or dropping a
 * command in `workspace/slash-commands.ts` updates this page with it.
 *
 * Skills and plugins register further commands per project. Those depend on
 * what is installed, so they cannot be listed on a public page — `/help` is
 * where a project's full set lives, each contributed command shown beside the
 * skill it came from.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = SLASH_COMMAND_REGISTRY.map(
  (command) => ({
    command: `/${command.name}`,
    args: command.argHint,
    group: command.category,
    description: command.description,
  }),
);

export type ApiEndpoint = {
  method: string;
  path: string;
  description: string;
};

/**
 * Karo's own REST surface, as the app itself calls it.
 *
 * Authenticated by the session cookie plus the `x-karo-csrf` header — **not** by
 * a Karo-issued API key, because there is no such thing. `/app/api-keys` and the
 * `user_api_keys` table are Bring-Your-Own-Key for *model providers*
 * (`lib/ai/index.ts` is their only reader); they do not authenticate anything
 * against these endpoints. Describing them as API-key accessible would send a
 * reader looking for a token they cannot mint.
 */
export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  { method: 'GET', path: '/api/projects', description: 'List the team’s projects.' },
  {
    method: 'POST',
    path: '/api/projects',
    description: 'Create a project from a template and provision its sandbox.',
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/files',
    description: 'List the workspace tree under a path.',
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/files/content',
    description: 'Read one file’s contents and detected language.',
  },
  {
    method: 'PUT',
    path: '/api/projects/{id}/files/content',
    description: 'Write a file. The path is normalised and confined to /workspace.',
  },
  {
    method: 'POST',
    path: '/api/conversations/{id}/messages',
    description: 'Send a message and stream the run back as server-sent events.',
  },
  {
    method: 'POST',
    path: '/api/conversations/{id}/stop',
    description: 'Cancel the run currently in flight.',
  },
  {
    method: 'POST',
    path: '/api/sandboxes/{id}/exec',
    description: 'Run a command in the sandbox and get the exit code, stdout and stderr.',
  },
  {
    method: 'GET',
    path: '/api/sandboxes/{id}/metrics',
    description: 'Current CPU, memory, disk and uptime for a sandbox.',
  },
  {
    method: 'GET',
    path: '/api/usage/summary?days=30',
    description: 'Usage totals for the period, by day and by project.',
  },
  {
    method: 'GET',
    path: '/api/usage/export?format=csv',
    description: 'Export itemised usage rows as CSV.',
  },
  {
    method: 'GET',
    path: '/api/health',
    description: 'Liveness of the app, database and providers.',
  },
];
