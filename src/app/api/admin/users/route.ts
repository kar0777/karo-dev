import { z } from 'zod';

import {
  listAdminUsers,
  type UserRoleFilter,
  type UserStatusFilter,
} from '@/app/admin/_data/users';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';

/**
 * Admin user search.
 *
 * `requireApiPlatformAdmin()` answers 404 rather than 403 so the endpoint is
 * indistinguishable from a route that does not exist.
 */

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  status: z.enum(['all', 'active', 'suspended']).default('all'),
  role: z.enum(['all', 'user', 'admin']).default('all'),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default', query: querySchema },
  async ({ query }) => {
    await requireApiPlatformAdmin();

    const result = await listAdminUsers({
      q: query.q,
      page: query.page,
      status: query.status as UserStatusFilter,
      role: query.role as UserRoleFilter,
    });

    return json(result);
  },
);
