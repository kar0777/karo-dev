import { describe, expect, it } from 'vitest';

import {
  assertCan,
  assignableRoles,
  can,
  canAll,
  canAny,
  isPlatformAdmin,
  outranks,
  PERMISSIONS,
  PermissionError,
  ROLE_PERMISSIONS,
  roleRank,
  TEAM_ROLES,
  type Permission,
} from '@/lib/rbac/permissions';

describe('role hierarchy', () => {
  it('ranks roles owner > admin > developer > viewer', () => {
    expect(roleRank('owner')).toBeGreaterThan(roleRank('admin'));
    expect(roleRank('admin')).toBeGreaterThan(roleRank('developer'));
    expect(roleRank('developer')).toBeGreaterThan(roleRank('viewer'));
  });

  it('gives each role a strict superset of the one below it', () => {
    const ordered = ['viewer', 'developer', 'admin', 'owner'] as const;
    for (let i = 1; i < ordered.length; i += 1) {
      const lower = ROLE_PERMISSIONS[ordered[i - 1]!];
      const higher = ROLE_PERMISSIONS[ordered[i]!];
      for (const permission of lower) {
        expect(higher).toContain(permission);
      }
      expect(higher.length).toBeGreaterThan(lower.length);
    }
  });

  it('describes every permission it grants', () => {
    for (const role of TEAM_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS[permission]).toBeTruthy();
      }
    }
  });
});

describe('can', () => {
  it('lets a viewer read but never write', () => {
    expect(can('viewer', 'project.read')).toBe(true);
    expect(can('viewer', 'usage.read')).toBe(true);
    expect(can('viewer', 'project.file.write')).toBe(false);
    expect(can('viewer', 'agent.run')).toBe(false);
    expect(can('viewer', 'terminal.use')).toBe(false);
    expect(can('viewer', 'sandbox.create')).toBe(false);
  });

  it('lets a developer build but not touch billing or membership', () => {
    expect(can('developer', 'agent.run')).toBe(true);
    expect(can('developer', 'terminal.use')).toBe(true);
    expect(can('developer', 'sandbox.destroy')).toBe(true);
    expect(can('developer', 'mcp.manage')).toBe(true);
    expect(can('developer', 'billing.read')).toBe(false);
    expect(can('developer', 'billing.manage')).toBe(false);
    expect(can('developer', 'team.invite')).toBe(false);
    expect(can('developer', 'project.delete')).toBe(false);
  });

  it('lets an admin manage the team and read billing, but not change the plan', () => {
    expect(can('admin', 'team.invite')).toBe(true);
    expect(can('admin', 'team.member.remove')).toBe(true);
    expect(can('admin', 'project.delete')).toBe(true);
    expect(can('admin', 'audit.read')).toBe(true);
    expect(can('admin', 'billing.read')).toBe(true);
    expect(can('admin', 'billing.manage')).toBe(false);
    expect(can('admin', 'team.role.update')).toBe(false);
    expect(can('admin', 'team.delete')).toBe(false);
  });

  it('gives the owner everything', () => {
    for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('denies everything for a non-member', () => {
    expect(can(null, 'project.read')).toBe(false);
    expect(can(undefined, 'project.read')).toBe(false);
  });
});

describe('canAll / canAny', () => {
  it('requires every permission for canAll', () => {
    expect(canAll('developer', ['project.read', 'agent.run'])).toBe(true);
    expect(canAll('developer', ['project.read', 'billing.manage'])).toBe(false);
  });

  it('requires only one for canAny', () => {
    expect(canAny('developer', ['billing.manage', 'agent.run'])).toBe(true);
    expect(canAny('viewer', ['billing.manage', 'agent.run'])).toBe(false);
  });

  it('treats an empty list as vacuously satisfied for canAll', () => {
    expect(canAll('viewer', [])).toBe(true);
    expect(canAny('owner', [])).toBe(false);
  });
});

describe('outranks', () => {
  it('lets a higher role act on a lower one', () => {
    expect(outranks('owner', 'admin')).toBe(true);
    expect(outranks('admin', 'developer')).toBe(true);
  });

  it('never lets a role act on an equal or higher one', () => {
    expect(outranks('admin', 'admin')).toBe(false);
    expect(outranks('admin', 'owner')).toBe(false);
    expect(outranks('developer', 'admin')).toBe(false);
  });

  it('means an admin cannot remove or demote the owner', () => {
    expect(outranks('admin', 'owner')).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('never lets anyone grant a role above their own', () => {
    for (const role of TEAM_ROLES) {
      for (const assignable of assignableRoles(role)) {
        expect(roleRank(assignable)).toBeLessThanOrEqual(roleRank(role));
      }
    }
  });

  it('lets an owner assign any role', () => {
    expect(assignableRoles('owner').sort()).toEqual([...TEAM_ROLES].sort());
  });

  it('lets an admin assign admin and below, but not owner', () => {
    const roles = assignableRoles('admin');
    expect(roles).toContain('admin');
    expect(roles).toContain('developer');
    expect(roles).not.toContain('owner');
  });

  it('leaves a viewer able to assign only viewer', () => {
    expect(assignableRoles('viewer')).toEqual(['viewer']);
  });
});

describe('assertCan', () => {
  it('passes silently when the role has the permission', () => {
    expect(() => assertCan('owner', 'billing.manage')).not.toThrow();
  });

  it('throws a 403-shaped error naming the permission and role', () => {
    let thrown: unknown;
    try {
      assertCan('viewer', 'sandbox.destroy');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PermissionError);
    const error = thrown as PermissionError;
    expect(error.status).toBe(403);
    expect(error.permission).toBe('sandbox.destroy');
    expect(error.role).toBe('viewer');
    expect(error.message).toContain('Viewer');
  });

  it('reports non-membership distinctly from insufficient role', () => {
    let thrown: PermissionError | null = null;
    try {
      assertCan(null, 'project.read');
    } catch (error) {
      thrown = error as PermissionError;
    }
    expect(thrown?.role).toBeNull();
    expect(thrown?.message).toContain('not a member');
  });
});

describe('isPlatformAdmin', () => {
  it('is true only for the admin platform role', () => {
    expect(isPlatformAdmin('admin')).toBe(true);
    expect(isPlatformAdmin('user')).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });

  it('is independent of team role — a team owner is not a platform admin', () => {
    expect(isPlatformAdmin('user')).toBe(false);
    expect(can('owner', 'team.delete')).toBe(true);
  });
});
