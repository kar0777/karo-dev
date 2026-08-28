/**
 * Next.js instrumentation.
 *
 * `onRequestError` is the only hook that sees the errors nobody catches: a
 * Server Component that throws while rendering, a failure inside a streamed
 * response after headers went out, a route handler that escaped its own
 * try/catch. Without this file those reached the browser as `error.tsx` and left
 * no correlated trace on the server — the boundary knows a `digest`, and until
 * now nothing on the server ever wrote that digest down, so the one identifier a
 * user could quote from the screen matched nothing in the logs.
 *
 * `register()` runs once per server process, before any request.
 *
 * Deliberately dependency-free: see src/lib/observability/report.ts for why an
 * error-tracking SDK is not baked in.
 */

/**
 * Loosely typed on purpose.
 *
 * The `context` argument has gained fields across Next.js releases, and pinning
 * it to today's shape turns a minor upgrade into a type error in a file that
 * only ever reads three properties out of it.
 */
type RequestErrorRequest = {
  path?: string;
  method?: string;
};

type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
};

export async function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): Promise<void> {
  // Next.js compiles this file for every runtime it builds, and the build
  // output confirms it: "Instrumentation" and "Edge Instrumentation" both
  // point here. The reporter is `server-only` and reaches for Node APIs, so
  // it must never be imported outside the Node runtime. Karo has no Edge
  // routes and no middleware today, which makes this branch unreachable —
  // it exists so that adding either does not turn error reporting into the
  // error.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    console.error('[karo] request error outside the Node runtime', error);
    return;
  }

  // Imported here rather than at module scope so the cost and the
  // server-only constraint stay on the path that actually throws.
  const { describeUnknown, reportError } = await import('@/lib/observability/report');

  const described = describeUnknown(error);

  await reportError({
    ...described,
    source: 'server',
    // `request.path` is the concrete URL; `routePath` is the pattern. Both
    // are useful and they are not the same thing when a param is involved.
    path: request.path,
    method: request.method,
    digest:
      typeof (error as { digest?: unknown })?.digest === 'string'
        ? (error as { digest: string }).digest
        : undefined,
    extra: {
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
      ...(context.renderSource ? { renderSource: context.renderSource } : {}),
      ...(context.revalidateReason ? { revalidateReason: context.revalidateReason } : {}),
    },
  });
}

/**
 * Startup banner.
 *
 * One line, at boot, saying which integrations actually resolved. Karo degrades
 * to mocks silently by design — that is the right behaviour for a first run, and
 * the wrong thing to discover three days into a production deployment because
 * nobody noticed the model provider never had a key. Reading it back at startup
 * is the cheapest possible guard against that.
 */
export async function register(): Promise<void> {
  // Edge and Node runtimes both evaluate this file; only the Node one can
  // read the server environment.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const [{ assertEnv }, { createLogger }] = await Promise.all([
    import('@/lib/env'),
    import('@/lib/logger'),
  ]);

  const log = createLogger('boot');

  try {
    const env = assertEnv();
    log.info('Karo starting', {
      version: process.env.npm_package_version ?? '1.0.0',
      nodeEnv: env.NODE_ENV,
      demoMode: env.DEMO_MODE,
      aiProvider: env.AI_PROVIDER,
      billingProvider: env.BILLING_PROVIDER,
      sandboxProvider: env.RESOLVED_SANDBOX_PROVIDER,
      emailTransport: env.EMAIL_TRANSPORT,
      errorWebhook: Boolean(process.env.ERROR_WEBHOOK_URL),
      scheduler: Boolean(process.env.CRON_SECRET),
    });
  } catch (error) {
    // `assertEnv` throws on a genuinely unusable production configuration —
    // a missing ENCRYPTION_KEY, `EMAIL_TRANSPORT=smtp` with no SMTP_URL.
    // Next.js would otherwise surface that as a request-time 500 per visitor;
    // saying it once at boot is what makes it findable.
    log.error('Environment configuration is not usable', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
