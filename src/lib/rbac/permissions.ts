import type { PlatformRole, TeamRole } from '@/lib/db/schema';

/**
 * Role-based access control.
 *
 * Two independent axes:
 *  · **Team role** — what a member may do inside one team's workspace.
 *  · **Platform role** — whether the user can reach `/admin` at all.
 *
 * Permissions are explicit strings rather than role comparisons, so a new role
 * (say `billing_only`) is one table entry, not a scattered `role !== 'viewer'`
 * audit across the codebase.
 */

export const PERMISSIONS = {
  // Projects
  'project.read': 'View projects and their files',
  'project.create': 'Create new projects',
  'project.update': 'Rename, configure and archive projects',
  'project.delete': 'Permanently delete projects',
  'project.file.write': 'Modify project files',

  // Agent & runtime
  'agent.run': 'Start agent runs and send chat messages',
  'agent.approve': 'Approve or reject agent changes and risky commands',
  'terminal.use': 'Open terminals and run commands in a sandbox',
  'sandbox.read': 'View sandboxes and their metrics',
  'sandbox.create': 'Create and start sandboxes',
  'sandbox.stop': 'Stop or restart sandboxes',
  'sandbox.destroy': 'Destroy sandboxes',

  // Extensions
  'mcp.read': 'View MCP servers',
  'mcp.manage': 'Add, edit and remove MCP servers',
  'skill.read': 'View installed skills',
  'skill.manage': 'Install, author and remove skills',
  'plugin.read': 'View installed plugins',
  'plugin.manage': 'Install, configure and remove plugins',

  // Credentials
  'apikey.read': 'See which API keys exist',
  'apikey.manage': 'Add, rotate and delete API keys',
  'worker.manage': 'Register and revoke your own servers',

  // Team & billing
  'team.read': 'View team members',
  'team.invite': 'Invite new members',
  'team.member.remove': 'Remove members',
  'team.role.update': "Change members' roles",
  'team.update': 'Rename the team and change its settings',
  'team.delete': 'Delete the team',
  'billing.read': 'View invoices, balance and usage',
  'billing.manage': 'Change plan, top up and manage payment methods',

  // Observability
  'usage.read': 'View usage and cost analytics',
  'audit.read': 'View the audit log',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const VIEWER: Permission[] = [
  'project.read',
  'sandbox.read',
  'mcp.read',
  'skill.read',
  'plugin.read',
  'team.read',
  'usage.read',
];

const DEVELOPER: Permission[] = [
  ...VIEWER,
  'project.create',
  'project.update',
  'project.file.write',
  'agent.run',
  'agent.approve',
  'terminal.use',
  'sandbox.create',
  'sandbox.stop',
  'sandbox.destroy',
  'mcp.manage',
  'skill.manage',
  'plugin.manage',
  'apikey.read',
  'apikey.manage',
];

const ADMIN: Permission[] = [
  ...DEVELOPER,
  'project.delete',
  'worker.manage',
  'team.invite',
  'team.member.remove',
  'team.update',
  'billing.read',
  'audit.read',
];

const OWNER: Permission[] = [...ADMIN, 'team.role.update', 'team.delete', 'billing.manage'];

export const ROLE_PERMISSIONS: Record<TeamRole, readonly Permission[]> = {
  viewer: Object.freeze(VIEWER),
  developer: Object.freeze(DEVELOPER),
  admin: Object.freeze(ADMIN),
  owner: Object.freeze(OWNER),
};

const ROLE_RANK: Record<TeamRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

export const TEAM_ROLES: readonly TeamRole[] = ['owner', 'admin', 'developer', 'viewer'];

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  owner: 'Full control, including billing and deleting the team.',
  admin: 'Manages projects, members and integrations. Can read billing.',
  developer: 'Builds with the agent: projects, sandboxes, terminals, extensions.',
  viewer: 'Read-only access to projects, usage and team information.',
};

export function can(role: TeamRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAll(
  role: TeamRole | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((p) => can(role, p));
}

export function canAny(
  role: TeamRole | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => can(role, p));
}

/** True when `actor` outranks `target` — required to change or remove them. */
export function outranks(actor: TeamRole, target: TeamRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

export function roleRank(role: TeamRole): number {
  return ROLE_RANK[role];
}

/** Roles an actor is allowed to assign — never above their own. */
export function assignableRoles(actor: TeamRole): TeamRole[] {
  return TEAM_ROLES.filter((r) => ROLE_RANK[r] <= ROLE_RANK[actor]);
}

export function isPlatformAdmin(role: PlatformRole | null | undefined): boolean {
  return role === 'admin';
}

/** Error carrying enough context for the API layer to render a 403 body. */
export class PermissionError extends Error {
  readonly permission: Permission;
  readonly role: TeamRole | null;
  readonly status = 403;

  constructor(permission: Permission, role: TeamRole | null) {
    super(
      role
        ? `Your role (${ROLE_LABELS[role]}) cannot ${PERMISSIONS[permission].toLowerCase()}.`
        : 'You are not a member of this team.',
    );
    this.name = 'PermissionError';
    this.permission = permission;
    this.role = role;
  }
}

export function assertCan(role: TeamRole | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new PermissionError(permission, role ?? null);
}
