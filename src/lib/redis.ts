import IORedis from 'ioredis';

import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

/**
 * Karo runs with **zero external services** by default. Redis is an
 * optimisation (shared rate-limit counters, cross-process pub/sub), never a
 * requirement, so this module exposes one narrow interface with two backends:
 *
 *  · `REDIS_URL` set  → ioredis, lazily connected;
 *  · otherwise        → an in-process store with the same semantics.
 *
 * Failures are never fatal. If Redis disappears mid-request the call falls
 * back to the memory store for that operation and a warning is logged once per
 * cooldown window. A degraded rate limiter is vastly better than a 500.
 */

const log = createLogger('redis');

export type RedisBackend = 'redis' | 'memory';

/** The only Redis surface Karo is allowed to depend on. */
export interface KaroRedis {
  readonly backend: RedisBackend;
  /** True only when a real Redis connection is established and healthy. */
  readonly connected: boolean;
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` omitted means "no expiry". */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  /** Seconds remaining, `-1` when no expiry, `-2` when the key is gone. */
  ttl(key: string): Promise<number>;
  /** Milliseconds remaining, same sentinel values as `ttl`. */
  pttl(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  /** Resolves to an unsubscribe function. */
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
}

/* ------------------------------------------------------------------ *
 *  In-memory backend
 * ------------------------------------------------------------------ */

type MemoryEntry = { value: string; expiresAt: number | null };

/**
 * Single-process store. Expiry is checked lazily on read plus a full sweep
 * every N writes, which keeps it allocation-free and timer-free (a `setInterval`
 * would keep a serverless lambda alive).
 */
class MemoryStore implements KaroRedis {
  readonly backend = 'memory' as const;
  readonly connected = false;

  private readonly data = new Map<string, MemoryEntry>();
  private readonly channels = new Map<string, Set<(message: string) => void>>();
  private writesSinceSweep = 0;

  private now(): number {
    return Date.now();
  }

  private read(key: string): MemoryEntry | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private maybeSweep(): void {
    this.writesSinceSweep += 1;
    if (this.writesSinceSweep < 512) return;
    this.writesSinceSweep = 0;
    const now = this.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.data.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : null,
    });
    this.maybeSweep();
  }

  async incr(key: string): Promise<number> {
    const entry = this.read(key);
    const next = (entry ? Number.parseInt(entry.value, 10) || 0 : 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    this.maybeSweep();
    return next;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const entry = this.read(key);
    if (!entry) return false;
    entry.expiresAt = this.now() + seconds * 1000;
    return true;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.data.delete(key)) removed += 1;
    return removed;
  }

  async ttl(key: string): Promise<number> {
    const ms = await this.pttl(key);
    return ms < 0 ? ms : Math.ceil(ms / 1000);
  }

  async pttl(key: string): Promise<number> {
    const entry = this.read(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, entry.expiresAt - this.now());
  }

  async publish(channel: string, message: string): Promise<number> {
    const handlers = this.channels.get(channel);
    if (!handlers) return 0;
    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        log.warn('In-memory subscriber threw', { channel, error });
      }
    }
    return handlers.size;
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = this.channels.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.channels.delete(channel);
    };
  }
}

/* ------------------------------------------------------------------ *
 *  Redis-backed facade
 * ------------------------------------------------------------------ */

type IORedisClient = InstanceType<typeof IORedis>;

const WARN_COOLDOWN_MS = 30_000;

class RedisFacade implements KaroRedis {
  readonly backend = 'redis' as const;

  private readonly memory: MemoryStore;
  private client: IORedisClient | null = null;
  private subscriber: IORedisClient | null = null;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();
  private lastWarnAt = 0;

  constructor(
    private readonly url: string,
    memory: MemoryStore,
  ) {
    this.memory = memory;
  }

  private connect(): IORedisClient | null {
    if (this.client) return this.client;
    try {
      const client = new IORedis(this.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        connectTimeout: 5_000,
        // Fail fast instead of silently queueing commands during an outage —
        // the caller falls back to the memory store on the rejection.
        enableOfflineQueue: false,
        retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
      });
      client.on('error', (error: Error) => this.warn('Redis connection error', error));
      client.on('ready', () => log.info('Redis connected'));
      void client.connect().catch((error: unknown) => {
        this.warn('Redis initial connect failed — using in-memory fallback', error);
      });
      this.client = client;
      return client;
    } catch (error) {
      this.warn('Could not construct a Redis client', error);
      return null;
    }
  }

  private warn(message: string, error?: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_COOLDOWN_MS) return;
    this.lastWarnAt = now;
    log.warn(message, { error, url: redactUrl(this.url) });
  }

  get connected(): boolean {
    return this.client?.status === 'ready';
  }

  private async run<T>(
    operation: string,
    withRedis: (client: IORedisClient) => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const client = this.connect();
    if (!client || client.status === 'end') return fallback();
    try {
      return await withRedis(client);
    } catch (error) {
      this.warn(`Redis ${operation} failed — falling back to memory`, error);
      return fallback();
    }
  }

  get(key: string): Promise<string | null> {
    return this.run(
      'GET',
      (c) => c.get(key),
      () => this.memory.get(key),
    );
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.run(
      'SET',
      async (c) => {
        if (ttlSeconds && ttlSeconds > 0) await c.set(key, value, 'EX', ttlSeconds);
        else await c.set(key, value);
      },
      () => this.memory.set(key, value, ttlSeconds),
    );
  }

  incr(key: string): Promise<number> {
    return this.run(
      'INCR',
      (c) => c.incr(key),
      () => this.memory.incr(key),
    );
  }

  expire(key: string, seconds: number): Promise<boolean> {
    return this.run(
      'EXPIRE',
      async (c) => (await c.expire(key, seconds)) === 1,
      () => this.memory.expire(key, seconds),
    );
  }

  del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return this.run(
      'DEL',
      (c) => c.del(...keys),
      () => this.memory.del(...keys),
    );
  }

  ttl(key: string): Promise<number> {
    return this.run(
      'TTL',
      (c) => c.ttl(key),
      () => this.memory.ttl(key),
    );
  }

  pttl(key: string): Promise<number> {
    return this.run(
      'PTTL',
      (c) => c.pttl(key),
      () => this.memory.pttl(key),
    );
  }

  publish(channel: string, message: string): Promise<number> {
    return this.run(
      'PUBLISH',
      (c) => c.publish(channel, message),
      () => this.memory.publish(channel, message),
    );
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    const client = this.connect();
    if (!client) return this.memory.subscribe(channel, handler);

    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    handlers.add(handler);

    try {
      // A connection in subscriber mode cannot run normal commands, so
      // subscriptions get their own duplicated connection.
      if (!this.subscriber) {
        const sub = client.duplicate();
        sub.on('error', (error: Error) => this.warn('Redis subscriber error', error));
        sub.on('message', (incoming: string, payload: string) => {
          for (const fn of this.handlers.get(incoming) ?? []) {
            try {
              fn(payload);
            } catch (error) {
              log.warn('Redis subscriber threw', { channel: incoming, error });
            }
          }
        });
        this.subscriber = sub;
      }
      await this.subscriber.subscribe(channel);
    } catch (error) {
      this.warn('Redis SUBSCRIBE failed — using in-memory pub/sub', error);
      handlers.delete(handler);
      return this.memory.subscribe(channel, handler);
    }

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        void this.subscriber?.unsubscribe(channel).catch(() => {});
      }
    };
  }
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '[unparseable redis url]';
  }
}

/* ------------------------------------------------------------------ *
 *  Module surface
 * ------------------------------------------------------------------ */

const globalForRedis = globalThis as unknown as {
  __karoRedis?: KaroRedis;
  __karoRedisMemory?: MemoryStore;
};

function memoryStore(): MemoryStore {
  globalForRedis.__karoRedisMemory ??= new MemoryStore();
  return globalForRedis.__karoRedisMemory;
}

/**
 * The shared client. Cached on `globalThis` so Next.js hot-reloading does not
 * open a new Redis connection on every file save.
 */
export function getRedis(): KaroRedis {
  if (globalForRedis.__karoRedis) return globalForRedis.__karoRedis;

  const url = env.REDIS_URL;
  const instance: KaroRedis = url ? new RedisFacade(url, memoryStore()) : memoryStore();

  if (!url) {
    log.debug('REDIS_URL is not set — using the in-memory store (single process).');
  }

  globalForRedis.__karoRedis = instance;
  return instance;
}

/**
 * True only when a real Redis connection is established and healthy.
 * Reads a property rather than testing `instanceof`: Next re-evaluates modules
 * on hot reload, which gives the class a new identity while the cached client
 * on `globalThis` keeps the old one.
 */
export function redisAvailable(): boolean {
  return getRedis().connected;
}

/** For tests: drop the cached client and the in-memory data. */
export function __resetRedisForTests(): void {
  globalForRedis.__karoRedis = undefined;
  globalForRedis.__karoRedisMemory = undefined;
}
