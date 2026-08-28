import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { loadAdminUserDetail } from '@/app/admin/_data/users';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';

/**
 * Read one account, or act on it.
 *
 * Two invariants are enforced here rather than in the UI, because the UI is not
 * a security boundary: an admin cannot act on their own account, and the last
 * remaining platform admin cannot be demoted or suspended — that would lock
 * everyone out of the console with no way back in.
 */

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    reason: z
      .string()
      .trim()
      .min(4, 'Give a reason of at least 4 characters — it is recorded in the audit log.')
      .max(500),
  }),
  z.object({ action: z.literal('unsuspend'), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('promote'), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('demote'), reason: z.string().trim().max(500).optional() }),
]);

function paramUserId(params: Record<string, string | string[] | undefined>): string {
  const value = params.userId;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new ValidationError('A user id is required.');
  return id;
}

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ params }) => {
    await requireApiPlatformAdmin();

    const detail = await loadAdminUserDetail(paramUserId(params));
    if (!detail) throw new NotFoundError('That user does not exist.');

    return json(detail);
  },
);

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: {
      action: AUDIT_ACTIONS.adminUserSuspend,
      resourceType: 'user',
      severity: 'warning',
    },
  },
  async ({ body, params, setAudit, req }) => {
    const { user: actor } = await requireApiPlatformAdmin();
    const userId = paramUserId(params);

    if (userId === actor.id) {
      throw new ConflictError('You cannot change your own account from the admin console.', {
        title: 'Not allowed on your own account',
        description:
          'Ask another platform admin to make this change, so a mistake here can never lock you out.',
      });
    }

    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const target = rows[0];
    if (!target) throw new NotFoundError('That user does not exist.');

    const removesAdmin = body.action === 'demote' || body.action === 'suspend';
    if (removesAdmin && target.platformRole === 'admin') {
      const admins = await db
        .select({ id: users.id, isSuspended: users.isSuspended })
        .from(users)
        .where(eq(users.platformRole, 'admin'));
      const survivors = admins.filter((row) => row.id !== target.id && !row.isSuspended);
      if (survivors.length === 0) {
        throw new ConflictError('This is the last platform admin.', {
          title: 'Last admin protected',
          description:
            'Promote another user to platform admin first — otherwise nobody could reach this console again.',
        });
      }
    }

    let summary: string;
    let action: string;

    switch (body.action) {
      case 'suspend': {
        await db
          .update(users)
          .set({ isSuspended: true, updatedAt: new Date() })
          .where(eq(users.id, userId));
        // Suspension must take effect now, not at session expiry.
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, userId));
        action = AUDIT_ACTIONS.adminUserSuspend;
        summary = `Suspended ${target.email}: ${body.reason}`;
        break;
      }
      case 'unsuspend': {
        await db
          .update(users)
          .set({ isSuspended: false, updatedAt: new Date() })
          .where(eq(users.id, userId));
        action = AUDIT_ACTIONS.adminUserRestore;
        summary = `Restored ${target.email}`;
        break;
      }
      case 'promote': {
        await db
          .update(users)
          .set({ platformRole: 'admin', updatedAt: new Date() })
          .where(eq(users.id, userId));
        action = AUDIT_ACTIONS.adminUserRoleChange;
        summary = `Promoted ${target.email} to platform admin`;
        break;
      }
      case 'demote': {
        await db
          .update(users)
          .set({ platformRole: 'user', updatedAt: new Date() })
          .where(eq(users.id, userId));
        action = AUDIT_ACTIONS.adminUserRoleChange;
        summary = `Removed platform admin from ${target.email}`;
        break;
      }
    }

    // The handler's own audit config only knows one action key; the concrete
    // one depends on the branch taken, so this route writes its own event.
    setAudit({ record: false });
    await recordAudit({
      action,
      actorType: 'user',
      userId: actor.id,
      resourceType: 'user',
      resourceId: userId,
      severity: 'warning',
      summary,
      metadata: {
        targetEmail: target.email,
        action: body.action,
        reason: body.reason ?? null,
        previousRole: target.platformRole,
      },
      request: req,
    });

    const detail = await loadAdminUserDetail(userId);
    return json({ ok: true, user: detail?.user ?? null, summary });
  },
);
