import { z } from 'zod';

import { getActiveTeam } from '@/lib/auth/guards';
import { defineHandler } from '@/lib/api/handler';
import { assertCan } from '@/lib/rbac/permissions';
import { usageCsvChunks, type UsageScope } from '@/lib/usage/analytics';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * CSV export of the metered request log.
 *
 * Streamed rather than buffered: an export is the one place a team legitimately
 * asks for a hundred thousand rows, and holding that in memory to set a
 * Content-Length would be the wrong trade.
 */

const query = z.object({
  format: z.enum(['csv']).default('csv').optional(),
  range: z.enum(['7', '30', '90', 'period']).default('30').optional(),
  projectId: z.string().min(1).optional(),
});

/** Safe for a `filename=` parameter on every platform. */
function safeSlug(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'team'
  );
}

function csvStream(scope: UsageScope): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = usageCsvChunks(scope)[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      // The client navigated away mid-download; stop paging the database.
      await iterator.return?.(undefined);
    },
  });
}

export const GET = defineHandler(
  { auth: 'required', query },
  async ({ user, query: input }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'usage.read');

    const context = await loadBillingContext(team.id);
    const range = input?.range ?? '30';

    const since =
      range === 'period'
        ? context.periodStart
        : (() => {
            const start = new Date();
            start.setUTCHours(0, 0, 0, 0);
            start.setUTCDate(start.getUTCDate() - (Number(range) - 1));
            return start;
          })();

    const scope: UsageScope = {
      teamId: team.id,
      since,
      projectId: input?.projectId ?? null,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `karo-usage-${safeSlug(team.slug)}-${stamp}.csv`;

    return new Response(csvStream(scope), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
