import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * Notes:
 *  - `'unsafe-inline'` on style-src is required by Next.js/Tailwind runtime style
 *    injection and Monaco's dynamic stylesheets.
 *  - `'unsafe-eval'` is enabled in development only (React Refresh). It is never
 *    enabled in production; the app itself never calls `eval`.
 *  - `worker-src blob:` is required by Monaco Editor web workers.
 */
function contentSecurityPolicy(isDev: boolean): string {
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `frame-src 'self' https://js.stripe.com https://hooks.stripe.com`,
    `connect-src 'self' ws: wss: https://api.stripe.com`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Emits `.next/standalone` — a self-contained server with a pruned
   * `node_modules` and its own `server.js`, which is what the `runner` stage of
   * the Dockerfile ships. Without this the production image cannot be built at
   * all: the `COPY .next/standalone` fails with "not found".
   *
   * Two things depend on it and are already configured below:
   * `outputFileTracingIncludes` (the worker agent is read off disk, not
   * imported, so tracing cannot find it) and `turbopack.root` (tracing is rooted
   * at the workspace root, which must not be inferred from a stray parent
   * lockfile).
   *
   * `public/` and `.next/static` are *not* included in the standalone output by
   * design — Next.js expects the deployment to copy them alongside. The
   * Dockerfile does exactly that.
   */
  output: 'standalone',

  turbopack: {
    /**
     * Pinned rather than inferred.
     *
     * Turbopack walks up from the project looking for a lockfile to decide the
     * workspace root. If anything above this directory happens to contain one —
     * an unrelated `package-lock.json` in a parent folder is enough — it picks
     * that instead, and then module resolution and the file tracing behind
     * `output: 'standalone'` are rooted somewhere that has nothing to do with
     * Karo. Naming the directory explicitly makes the build independent of
     * whatever else lives on the machine.
     */
    root: fileURLToPath(new URL('.', import.meta.url)),
  },

  // Keep server-only native/heavy modules out of the bundler graph.
  // `nodemailer` is here because it resolves its transports with dynamic
  // requires that a bundler cannot follow; bundling it produces a build that
  // works until the first attempt to actually send.
  serverExternalPackages: ['dockerode', 'postgres', 'ioredis', 'ssh2', 'nodemailer'],

  /**
   * `/api/worker/install` reads the worker agent off disk to serve it, and file
   * tracing only follows imports — so a standalone build would ship without it
   * and the BYOS install command would 500 in production while working locally.
   */
  outputFileTracingIncludes: {
    '/api/worker/install': ['./worker/karo-worker.mjs'],
  },

  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy(isDev) },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          ...(isDev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]),
        ],
      },
      {
        // Never cache authenticated surfaces.
        source: '/app/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default nextConfig;
