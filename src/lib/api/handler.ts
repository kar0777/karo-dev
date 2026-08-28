import type { NextRequest } from 'next/server';

import type { ZodType, z } from 'zod';

import { assertCsrf } from '@/lib/api/csrf';
import {
  ApiError,
  EmailUnverifiedError,
  MaintenanceModeError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
  isNextControlFlowError,
  toApiError,
  zodIssues,
} from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/responses';
import {
  AUDIT_ACTIONS,
  recordAudit,
  type AuditAction,
  type AuditActorType,
  type AuditSeverity,
} from '@/lib/audit';
import { isBlockedByEmailVerification } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import type { Session, User } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import {
  RATE_LIMITS,
  clientIpFromRequest,
  rateLimit,
  rateLimitHeaders,
  type RateLimitName,
} from '@/lib/rate-limit';
import { isPlatformAdmin } from '@/lib/rbac/permissions';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/**
 * `defineHandler` — the single entry point every route handler goes through.
 *
 * It enforces the pipeline the security rules mandate, in order:
 *   authenticate → CSRF → rate-limit → validate → act → audit
 *
 * and guarantees that no route can accidentally skip a step or invent its own
 * error shape. Anything thrown anywhere below becomes the standard envelope.
 */

const log = createLogger('api');

export type AuthMode = 'required' | 'optional' | 'none';

export type RouteParams = Record<string, string | string[] | undefined>;

/** Next 16 hands route handlers a context whose `params` is a Promise. */
export type RouteContext<P extends RouteParams = RouteParams> = {
  params: Promise<P>;
};

export type AuditConfig = {
  action: AuditAction | (string & Record<never, never>);
  resourceType: string;
  severity?: AuditSeverity;
  actorType?: AuditActorType;
  /** Skips the write when the handler already recorded a richer event. */
  skipWhenUnset?: boolean;
};

export type HandlerConfig<
  TBody extends ZodType | undefined = undefined,
  TQuery extends ZodType | undefined = undefined,
  TAuth extends AuthMode = 'required',
> = {
  /** Defaults to `'required'`. */
  auth?: TAuth;
  /** Defaults to `true` for unsafe methods. Webhooks set it to `false`. */
  csrf?: boolean;
  /** Named policy, or `false` to opt out entirely. Defaults to `api.default`. */
  rateLimit?: RateLimitName | false;
  body?: TBody;
  query?: TQuery;
  audit?: AuditConfig;
};

type BodyOf<T> = T extends ZodType ? z.infer<T> : undefined;
type QueryOf<T> = T extends ZodType ? z.infer<T> : undefined;
type UserOf<A extends AuthMode> = A extends 'required' ? User : User | null;
type SessionOf<A extends AuthMode> = A extends 'required' ? Session : Session | null;

/** What a handler receives. Everything is already validated and authorised. */
export type HandlerInput<
  TBody extends ZodType | undefined,
  TQuery extends ZodType | undefined,
  TAuth extends AuthMode,
> = {
  req: NextRequest;
  ctx: RouteContext;
  params: RouteParams;
  user: UserOf<TAuth>;
  session: SessionOf<TAuth>;
  body: BodyOf<TBody>;
  query: QueryOf<TQuery>;
  ip: string;
  requestId: string;
  /**
   * Enriches the audit event this route writes. Call it once the handler knows
   * what it actually touched — the resource id rarely exists before the work.
   */
  setAudit(patch: AuditPatch): void;
};

export type AuditPatch = {
  teamId?: string | null;
  resourceId?: string | null;
  summary?: string;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  /** Set to `false` to suppress the automatic write for this request. */
  record?: boolean;
};

export type RouteHandler = <P extends RouteParams>(
  req: NextRequest,
  ctx: RouteContext<P>,
) => Promise<Response>;

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Route prefixes that keep accepting writes from an account that has not
 * confirmed its address while `auth.requireEmailVerification` is on. They are
 * the escape hatches enumerated on `isBlockedByEmailVerification`: `/api/auth/`
 * is confirm, resend and sign out; `/api/settings/` is the user's own profile,
 * where a mistyped address is corrected and a fresh link is sent to it.
 *
 * `/api/billing/controls` is here for a different reason. It is the only writer
 * of the spending cap and of `teams.auto_topup_enabled`, and the sweep that acts
 * on that flag runs off a scheduler credential with no session, so the gate
 * never reaches it. Closed, this route would leave a blocked owner watching
 * their card be charged every time the balance dips with no way to stop it —
 * the gate refusing the one request that *reduces* what leaves their account
 * while the charging carries on. The route moves no money itself and is still
 * behind `billing.manage`. A path-level list cannot tell arming auto top-up from
 * disarming it, so it permits both; that is the team's own money under a role
 * that already governs it, and a far smaller hole than a charge nobody can stop.
 *
 * A prefix list rather than a per-route opt-out flag, because the check lives
 * in this factory: a route that forgot to opt *in* would silently stay open,
 * whereas a route missing from this list fails loudly and visibly instead.
 */
const VERIFICATION_OPEN_PREFIXES = [
  '/api/auth/',
  '/api/settings/',
  '/api/billing/controls',
] as const;

function isVerificationOpenPath(path: string): boolean {
  return VERIFICATION_OPEN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Writes that maintenance mode keeps accepting from an ordinary signed-in user.
 *
 * Both are ways *out* of a state the caller is stuck in, not new work. Signing
 * out is neither saving a change nor starting one, and refusing it is worse than
 * cosmetic: `destroySession` never runs, so the cookie and the session row
 * survive, /login sees a live session and sends the user straight back into the
 * app. On a shared machine that is somebody unable to end their session at all
 * until an administrator happens to turn the flag off. Confirming an address is
 * how a user clears the verification gate above, so leaving it closed stacks one
 * refusal on another for the whole duration of the window.
 *
 * Signing in and registering need no entry here: they are POSTs made by nobody,
 * and the gate below only runs once a session exists.
 */
const MAINTENANCE_OPEN_PREFIXES = ['/api/auth/logout', '/api/auth/verify-email'] as const;

function isMaintenanceOpenPath(path: string): boolean {
  return MAINTENANCE_OPEN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The `platform.maintenanceMode` gate, and the proof that turning it on cannot
 * take the switch with it.
 *
 * A control that refuses writes is only safe if the way back *out* is not one of
 * the writes it refuses. Two clauses guarantee that for the administrator, and
 * neither is a path allowlist somebody has to keep in step with the routes:
 *
 *  · **Platform admins are exempt.** `PATCH /api/admin/settings` — the only
 *    writer of this flag — sits behind `requireApiPlatformAdmin`, so every
 *    caller that route would ever honour is already in the exempt set. There is
 *    no request this gate refuses that the settings route would have accepted,
 *    which is what makes the switch impossible to turn one-way. It also means an
 *    admin keeps working normally while maintenance is on, which is usually the
 *    point of turning it on.
 *  · **No session, no refusal.** Signing in is a POST made by nobody, so an
 *    admin whose session expired mid-incident can still get back in and reach
 *    the exemption above. The same clause keeps machine traffic flowing: the
 *    billing webhook and the worker callbacks authenticate with a signature
 *    rather than a session, and refusing an event already in flight would lose a
 *    payment or leave a sandbox row describing a machine that has since stopped.
 *
 * Neither clause covers the *user* whose only exits carry their session, which is
 * what `MAINTENANCE_OPEN_PREFIXES` above is for.
 *
 * Reads are untouched — during an incident, being able to look at things is most
 * of what people want. So are server actions, which do not pass through this
 * factory; Karo has exactly one, and it finishes onboarding — the caller's own
 * user row and the agent permissions on the project they just made.
 */
async function isRefusedByMaintenance(user: User): Promise<boolean> {
  if (isPlatformAdmin(user.platformRole)) return false;
  return getSetting(
    SETTING_KEYS.platformMaintenanceMode,
    settingDefault(SETTING_KEYS.platformMaintenanceMode),
  );
}

/** Repeated keys become arrays so `z.array()` schemas work as written. */
function searchParamsToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return out;
}

async function parseJsonBody(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const raw = await req.text();
    if (raw.trim() === '') return {};
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ValidationError('The request body is not valid JSON.', [
        { path: '', message: 'Malformed JSON', code: 'invalid_json' },
      ]);
    }
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await req.formData();
    const out: Record<string, unknown> = {};
    for (const key of new Set(form.keys())) {
      const values = form.getAll(key);
      out[key] = values.length > 1 ? values : values[0];
    }
    return out;
  }

  // No content type and no body is a legitimate DELETE.
  const raw = await req.text();
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError(
      'Send the request body as JSON with a `content-type: application/json` header.',
      [{ path: '', message: 'Unsupported body encoding', code: 'unsupported_media_type' }],
    );
  }
}

function parseWith<T extends ZodType>(schema: T, value: unknown, source: 'body' | 'query') {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<T>;
  throw new ValidationError(
    source === 'body'
      ? 'The request body failed validation.'
      : 'The query parameters failed validation.',
    zodIssues(result.error),
  );
}

function rateLimitBucket(name: RateLimitName, ip: string, userId: string | null): string {
  const policy = RATE_LIMITS[name];
  switch (policy.scope) {
    case 'global':
      return 'global';
    case 'user':
      return userId ? `user:${userId}` : `ip:${ip}`;
    case 'ip':
    case 'ip+identifier':
    default:
      // The identifier half (an email, a project id) is only known after the
      // body is parsed, so routes that need it apply a second, narrower bucket
      // themselves. This one still caps the IP.
      return `ip:${ip}`;
  }
}

/* ------------------------------------------------------------------ *
 *  defineHandler
 * ------------------------------------------------------------------ */

export function defineHandler<
  TBody extends ZodType | undefined = undefined,
  TQuery extends ZodType | undefined = undefined,
  TAuth extends AuthMode = 'required',
>(
  config: HandlerConfig<TBody, TQuery, TAuth>,
  fn: (input: HandlerInput<TBody, TQuery, TAuth>) => Promise<Response> | Response,
): RouteHandler {
  const authMode: AuthMode = config.auth ?? 'required';

  return async function handler<P extends RouteParams>(
    req: NextRequest,
    ctx: RouteContext<P>,
  ): Promise<Response> {
    const requestId = newId(ID_PREFIX.task);
    const started = Date.now();
    const ip = clientIpFromRequest(req);
    const method = req.method.toUpperCase();
    const path = req.nextUrl.pathname;

    let auditPatch: AuditPatch = {};
    let user: User | null = null;
    let session: Session | null = null;
    let extraHeaders: Record<string, string> = {};

    try {
      /* 1 — authenticate ------------------------------------------------ */
      if (authMode !== 'none') {
        const active = await getSession();
        if (active) {
          user = active.user;
          session = active.session;
        }
        if (authMode === 'required' && !user) throw new UnauthorizedError();
        if (user?.isSuspended) {
          throw new ApiError({
            status: 403,
            code: 'forbidden',
            message: 'This account is suspended.',
            title: 'Account suspended',
            description:
              'A platform administrator suspended this account. Contact support to restore access.',
          });
        }

        // Reads are deliberately untouched: an unconfirmed user can still see
        // everything they already have, they just cannot spend or change it.
        // Token-authenticated traffic (workers, webhooks) runs with no session
        // and so never reaches this branch.
        if (user && UNSAFE_METHODS.has(method) && !isVerificationOpenPath(path)) {
          if (await isBlockedByEmailVerification(user)) throw new EmailUnverifiedError();
        }

        // Maintenance mode. The exemption is normally the caller rather than the
        // path; the two paths that opt out are the ones a refusal would trap
        // somebody in rather than merely delay.
        if (
          user &&
          UNSAFE_METHODS.has(method) &&
          !isMaintenanceOpenPath(path) &&
          (await isRefusedByMaintenance(user))
        ) {
          throw new MaintenanceModeError();
        }
      }

      /* 2 — CSRF -------------------------------------------------------- */
      const csrfEnabled = config.csrf ?? true;
      if (csrfEnabled && UNSAFE_METHODS.has(method)) {
        await assertCsrf(req);
      }

      /* 3 — rate limit -------------------------------------------------- */
      if (config.rateLimit !== false) {
        const name: RateLimitName = config.rateLimit ?? 'api.default';
        const policy = RATE_LIMITS[name];
        const result = await rateLimit({
          key: `${name}:${rateLimitBucket(name, ip, user?.id ?? null)}`,
          limit: policy.limit,
          windowSeconds: policy.windowSeconds,
        });

        extraHeaders = rateLimitHeaders(result);

        if (!result.allowed) {
          void recordAudit({
            action: AUDIT_ACTIONS.rateLimited,
            userId: user?.id ?? null,
            actorType: user ? 'user' : 'system',
            resourceType: 'api',
            resourceId: path,
            severity: 'warning',
            summary: `Rate limit "${name}" hit`,
            metadata: { policy: name, method, path },
            request: req,
          });
          throw new RateLimitError(result.retryAfterSeconds);
        }
      }

      /* 4 — validate ---------------------------------------------------- */
      const params = (await ctx.params) as RouteParams;

      const body = (
        config.body ? parseWith(config.body, await parseJsonBody(req), 'body') : undefined
      ) as BodyOf<TBody>;

      const query = (
        config.query
          ? parseWith(config.query, searchParamsToObject(req.nextUrl), 'query')
          : undefined
      ) as QueryOf<TQuery>;

      /* 5 — act --------------------------------------------------------- */
      const response = await fn({
        req,
        ctx: ctx as RouteContext,
        params,
        user: user as UserOf<TAuth>,
        session: session as SessionOf<TAuth>,
        body,
        query,
        ip,
        requestId,
        setAudit: (patch) => {
          auditPatch = { ...auditPatch, ...patch };
        },
      });

      /* 6 — audit ------------------------------------------------------- */
      if (config.audit && auditPatch.record !== false && response.status < 400) {
        await recordAudit({
          action: config.audit.action,
          actorType: config.audit.actorType ?? (user ? 'user' : 'system'),
          resourceType: config.audit.resourceType,
          resourceId: auditPatch.resourceId ?? null,
          teamId: auditPatch.teamId ?? null,
          userId: user?.id ?? null,
          severity: auditPatch.severity ?? config.audit.severity ?? 'info',
          summary: auditPatch.summary,
          metadata: auditPatch.metadata,
          request: req,
        });
      }

      for (const [key, value] of Object.entries(extraHeaders)) {
        response.headers.set(key, value);
      }
      response.headers.set('x-karo-request-id', requestId);

      log.debug('Request handled', {
        requestId,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
        userId: user?.id,
      });

      return response;
    } catch (error) {
      // `redirect()` / `notFound()` are implemented as throws — swallowing them
      // here would turn a redirect into a 500.
      if (isNextControlFlowError(error)) throw error;

      const apiError = toApiError(error);
      const context = {
        requestId,
        method,
        path,
        status: apiError.status,
        code: apiError.code,
        durationMs: Date.now() - started,
        userId: user?.id,
        error,
      };

      if (apiError.status >= 500) log.error('Request failed', context);
      else log.warn('Request rejected', context);

      return errorResponse(apiError, {
        headers: { ...extraHeaders, 'x-karo-request-id': requestId },
      });
    }
  };
}
