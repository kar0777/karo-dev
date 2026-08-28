import { redactSecrets } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { clientIpFromRequest } from '@/lib/rate-limit';

/**
 * The audit trail.
 *
 * Two rules make this module trustworthy:
 *  1. **It never throws.** An audit write failing must not roll back the thing
 *     it was describing — the operation already happened, and refusing to
 *     complete it would be worse than a gap in the log.
 *  2. **Metadata is always redacted.** Callers pass whole request payloads
 *     without having to think about which field held an API key.
 */

const log = createLogger('audit');

export const AUDIT_ACTIONS = {
  authRegister: 'auth.register',
  authLogin: 'auth.login',
  authLoginFailed: 'auth.login_failed',
  authLogout: 'auth.logout',
  authDemoLogin: 'auth.demo_login',
  authEmailVerified: 'auth.email_verified',
  authPasswordResetRequested: 'auth.password_reset_requested',
  authPasswordReset: 'auth.password_reset',
  authPasswordChanged: 'auth.password_changed',
  authSessionsRevoked: 'auth.sessions_revoked',

  projectCreate: 'project.create',
  projectUpdate: 'project.update',
  projectArchive: 'project.archive',
  projectDelete: 'project.delete',
  projectFileWrite: 'project.file_write',
  projectFileDelete: 'project.file_delete',

  sandboxCreate: 'sandbox.create',
  sandboxStart: 'sandbox.start',
  sandboxStop: 'sandbox.stop',
  sandboxDestroy: 'sandbox.destroy',
  sandboxCommand: 'sandbox.command',
  sandboxCommandDenied: 'sandbox.command_denied',

  agentRunStart: 'agent.run_start',
  agentRunFinish: 'agent.run_finish',
  agentRunCancel: 'agent.run_cancel',
  agentToolApprove: 'agent.tool_approve',
  agentToolReject: 'agent.tool_reject',

  apikeyCreate: 'apikey.create',
  apikeyUpdate: 'apikey.update',
  apikeyDelete: 'apikey.delete',

  mcpCreate: 'mcp.create',
  mcpUpdate: 'mcp.update',
  mcpDelete: 'mcp.delete',
  mcpConnect: 'mcp.connect',

  pluginInstall: 'plugin.install',
  pluginConfigure: 'plugin.configure',
  pluginUninstall: 'plugin.uninstall',
  skillInstall: 'skill.install',
  skillCreate: 'skill.create',
  skillUninstall: 'skill.uninstall',

  billingCheckout: 'billing.checkout',
  billingTopup: 'billing.topup',
  billingCouponRedeem: 'billing.coupon_redeem',
  billingPlanChange: 'billing.plan_change',
  billingCancel: 'billing.cancel',
  billingWebhook: 'billing.webhook',
  billingSpendCapUpdate: 'billing.spend_cap_update',

  teamCreate: 'team.create',
  teamUpdate: 'team.update',
  teamDelete: 'team.delete',
  teamInvite: 'team.invite',
  teamInviteAccept: 'team.invite_accept',
  teamInviteRevoke: 'team.invite_revoke',
  teamMemberRemove: 'team.member_remove',
  teamRoleChange: 'team.role_change',

  workerRegister: 'worker.register',
  workerHeartbeat: 'worker.heartbeat',
  workerRevoke: 'worker.revoke',

  adminSettingUpdate: 'admin.setting_update',
  adminPlanUpdate: 'admin.plan_update',
  adminModelUpdate: 'admin.model_update',
  adminUserSuspend: 'admin.user_suspend',
  adminUserRestore: 'admin.user_restore',
  adminUserRoleChange: 'admin.user_role_change',
  adminIncidentUpdate: 'admin.incident_update',
  adminCatalogSync: 'admin.catalog_sync',
  adminCouponCreate: 'admin.coupon_create',
  adminCouponUpdate: 'admin.coupon_update',

  cronTick: 'cron.tick',

  quotaExceeded: 'quota.exceeded',
  rateLimited: 'security.rate_limited',
  csrfRejected: 'security.csrf_rejected',
  ssrfBlocked: 'security.ssrf_blocked',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Short, human phrasing for the audit table in the UI. */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  'auth.register': 'Account created',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.demo_login': 'Signed in to the demo account',
  'auth.email_verified': 'Email verified',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'auth.password_changed': 'Password changed',
  'auth.sessions_revoked': 'All sessions revoked',

  'project.create': 'Project created',
  'project.update': 'Project updated',
  'project.archive': 'Project archived',
  'project.delete': 'Project deleted',
  'project.file_write': 'File written',
  'project.file_delete': 'File deleted',

  'sandbox.create': 'Sandbox created',
  'sandbox.start': 'Sandbox started',
  'sandbox.stop': 'Sandbox stopped',
  'sandbox.destroy': 'Sandbox destroyed',
  'sandbox.command': 'Command run in sandbox',
  'sandbox.command_denied': 'Command blocked by policy',

  'agent.run_start': 'Agent run started',
  'agent.run_finish': 'Agent run finished',
  'agent.run_cancel': 'Agent run cancelled',
  'agent.tool_approve': 'Tool call approved',
  'agent.tool_reject': 'Tool call rejected',

  'apikey.create': 'API key added',
  'apikey.update': 'API key updated',
  'apikey.delete': 'API key deleted',

  'mcp.create': 'MCP server added',
  'mcp.update': 'MCP server updated',
  'mcp.delete': 'MCP server removed',
  'mcp.connect': 'MCP server connected',

  'plugin.install': 'Plugin installed',
  'plugin.configure': 'Plugin configured',
  'plugin.uninstall': 'Plugin removed',
  'skill.install': 'Skill installed',
  'skill.create': 'Skill authored',
  'skill.uninstall': 'Skill removed',

  'billing.checkout': 'Checkout started',
  'billing.topup': 'Balance topped up',
  'billing.coupon_redeem': 'Promo code redeemed',
  'billing.plan_change': 'Plan changed',
  'billing.cancel': 'Subscription cancelled',
  'billing.webhook': 'Billing webhook processed',
  'billing.spend_cap_update': 'Spend cap changed',

  'team.create': 'Team created',
  'team.update': 'Team updated',
  'team.delete': 'Team deleted',
  'team.invite': 'Member invited',
  'team.invite_accept': 'Invitation accepted',
  'team.invite_revoke': 'Invitation revoked',
  'team.member_remove': 'Member removed',
  'team.role_change': 'Member role changed',

  'worker.register': 'Server registered',
  'worker.heartbeat': 'Server heartbeat',
  'worker.revoke': 'Server revoked',

  'admin.setting_update': 'Platform setting changed',
  'admin.plan_update': 'Plan updated',
  'admin.model_update': 'Model updated',
  'admin.user_suspend': 'User suspended',
  'admin.user_restore': 'User restored',
  'admin.user_role_change': 'Platform role changed',
  'admin.incident_update': 'Incident updated',
  'admin.catalog_sync': 'Model catalogue synced',
  'admin.coupon_create': 'Promo code created',
  'admin.coupon_update': 'Promo code updated',

  'cron.tick': 'Scheduled maintenance tick',

  'quota.exceeded': 'Quota exceeded',
  'security.rate_limited': 'Rate limit hit',
  'security.csrf_rejected': 'CSRF check failed',
  'security.ssrf_blocked': 'Outbound request blocked',
};

/** Fallback for actions written before their label existed. */
export function auditActionLabel(action: string): string {
  const known = AUDIT_LABELS[action as AuditAction];
  if (known) return known;
  const [, verb = action] = action.split('.');
  return verb.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export type AuditSeverity = 'info' | 'notice' | 'warning' | 'critical';
export type AuditActorType = 'user' | 'system' | 'agent' | 'worker' | 'webhook';

export type RecordAuditInput = {
  /** A value from `AUDIT_ACTIONS`; free strings are accepted but discouraged. */
  action: AuditAction | (string & Record<never, never>);
  teamId?: string | null;
  userId?: string | null;
  actorType?: AuditActorType;
  resourceType?: string;
  resourceId?: string | null;
  severity?: AuditSeverity;
  summary?: string;
  metadata?: Record<string, unknown>;
  /** IP and user-agent are extracted from this when given. */
  request?: Request | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const ipAddress =
      input.ipAddress ?? (input.request ? clientIpFromRequest(input.request) : null);
    const userAgent =
      input.userAgent ?? input.request?.headers.get('user-agent')?.slice(0, 512) ?? null;

    await db.insert(auditEvents).values({
      id: newId(ID_PREFIX.auditEvent),
      teamId: input.teamId ?? null,
      userId: input.userId ?? null,
      actorType: input.actorType ?? 'user',
      action: input.action,
      resourceType: input.resourceType ?? '',
      resourceId: input.resourceId ?? null,
      severity: input.severity ?? 'info',
      summary: input.summary ?? auditActionLabel(input.action),
      metadata: input.metadata ? redactSecrets(input.metadata) : null,
      ipAddress: ipAddress === 'unknown' ? null : ipAddress,
      userAgent,
    });
  } catch (error) {
    log.error('Could not write an audit event', {
      action: input.action,
      resourceId: input.resourceId,
      error,
    });
  }
}
