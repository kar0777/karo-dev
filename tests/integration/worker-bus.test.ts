import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/lib/db';
import { byosWorkers, teams, teamMembers, users } from '@/lib/db/schema';
import { newId } from '@/lib/ids';
import {
  complete,
  dispatch,
  drainWorker,
  isWorkerOnline,
  poll,
} from '@/lib/sandbox/worker-bus';

/**
 * Worker-bus integration tests.
 *
 * The bus queue lives in `byos_commands` precisely because it must survive
 * process boundaries on serverless hosting, so the thing under test *is* the
 * database: a queued row must be claimable by a different connection than the
 * one that dispatched it, and a result written by a third must resolve the
 * first. Mocking the driver would test nothing.
 *
 * Set DATABASE_URL to a throwaway database — the suite creates its own worker
 * under a unique team and removes everything afterwards.
 */

const ids = {
  user: newId('user'),
  team: newId('team'),
  worker: newId('worker'),
};

let reachable = false;

beforeAll(async () => {
  try {
    await pg`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await db.insert(users).values({
    id: ids.user,
    email: `worker-bus-${ids.user}@karo.test`,
    name: 'Worker Bus Fixture',
    emailVerifiedAt: new Date(),
  });
  await db.insert(teams).values({
    id: ids.team,
    name: 'Worker Bus Fixture Team',
    slug: `worker-bus-${ids.team.slice(-8)}`,
    ownerId: ids.user,
  });
  await db
    .insert(teamMembers)
    .values({ id: newId('teamMember'), teamId: ids.team, userId: ids.user, role: 'owner' });
  await db.insert(byosWorkers).values({
    id: ids.worker,
    teamId: ids.team,
    createdById: ids.user,
    name: 'bus-fixture',
    status: 'online',
    installTokenHash: `fixture-${ids.worker}`,
    installTokenExpiresAt: new Date(Date.now() + 60_000),
    lastHeartbeatAt: new Date(),
  });
});

afterAll(async () => {
  if (!reachable) return;
  await db.delete(byosWorkers).where(eq(byosWorkers.id, ids.worker));
  await db.delete(teams).where(eq(teams.id, ids.team));
  await db.delete(users).where(eq(users.id, ids.user));
});

describe('worker bus against a real database', () => {
  it('is connected — otherwise these assertions prove nothing', () => {
    expect(reachable).toBe(true);
  });

  it('delivers a queued command through a separate long-poll and resolves on its result', async () => {
    const pending = dispatch(
      ids.worker,
      { kind: 'status', sandboxExternalId: 'karo-fixture' },
      10_000,
    );

    // Let the insert land before claiming — dispatch is intentionally not
    // awaited here, since the caller's await belongs to the result.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A fresh poll — the same code path a different serverless instance would
    // run — must claim what dispatch inserted.
    const commands = await poll(ids.worker);
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command).toMatchObject({ kind: 'status', sandboxExternalId: 'karo-fixture' });

    await complete(ids.worker, {
      commandId: command.id,
      ok: true,
      data: { status: 'running' },
    });

    const result = await pending;
    expect(result).toMatchObject({ commandId: command.id, ok: true });
    expect((result.data as { status?: string }).status).toBe('running');
  });

  it('rejects when no worker claims the command before the timeout', async () => {
    await expect(
      dispatch(ids.worker, { kind: 'metrics', sandboxExternalId: 'karo-fixture' }, 1_500),
    ).rejects.toThrow(/did not respond in time/);
  });

  it('fails outstanding commands when the worker is drained (revocation)', async () => {
    const pending = dispatch(
      ids.worker,
      { kind: 'stop', sandboxExternalId: 'karo-fixture' },
      15_000,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await drainWorker(ids.worker, 'This server was revoked.');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('This server was revoked.');
  });

  it('reads liveness from the recorded heartbeat, not from process memory', async () => {
    expect(await isWorkerOnline(ids.worker)).toBe(true);

    await db
      .update(byosWorkers)
      .set({ lastHeartbeatAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(byosWorkers.id, ids.worker));

    expect(await isWorkerOnline(ids.worker)).toBe(false);
    expect(await isWorkerOnline(ids.worker, 10 * 60_000)).toBe(true);
  });
});
