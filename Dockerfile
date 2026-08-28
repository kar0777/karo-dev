# ==================================================================== #
#  Karo — control plane image (the Next.js app)
#
#  Three stages:
#    deps     install node_modules from the lockfile only  (cacheable)
#    builder  compile the Next.js standalone bundle
#    runner   ~180 MB runtime with no npm, no sources, no devDeps
#
#  Build:  docker build -t karo/app:1 .
#  Run:    docker run --rm -p 3000:3000 --env-file .env karo/app:1
#
#  NOTE — COUPLING TO next.config.ts
#  ---------------------------------
#  The `runner` stage copies `.next/standalone`, which Next.js emits only
#  because next.config.ts sets `output: 'standalone'`. If that setting is
#  ever removed, this build breaks at the COPY with "not found" — the two
#  files have to agree.
#
#  `public/` and `.next/static` are deliberately outside the standalone
#  bundle; Next.js expects the deployment to place them, which is why they
#  are copied separately below.
# ==================================================================== #

ARG NODE_VERSION=24-alpine


# ---------------------------------------------------------------- #
#  Stage 1 — deps
# ---------------------------------------------------------------- #
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# libc6-compat: some native-ish transitive deps assume glibc symbols.
RUN apk add --no-cache libc6-compat

# Only the manifests, so this layer is reused until dependencies change.
COPY package.json package-lock.json .npmrc ./

# `npm ci` is lockfile-exact and fails if package.json and the lock drift.
RUN npm ci --include=dev --no-audit --no-fund


# ---------------------------------------------------------------- #
#  Stage 2 — builder
# ---------------------------------------------------------------- #
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build must not require a database or any credential: `src/lib/env.ts`
# resolves an empty environment to demo mode on purpose. Anything that
# genuinely needs a secret is read at request time, never at build time.
RUN npm run build


# ---------------------------------------------------------------- #
#  Stage 3 — runner
# ---------------------------------------------------------------- #
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# wget (busybox) backs the HEALTHCHECK below; tini reaps zombies so that
# a Next.js worker crash cannot leave defunct processes behind.
RUN apk add --no-cache tini wget

# The `node` user (uid 1000) ships with the official image. Reuse it
# rather than minting another uid so bind-mounted volumes stay sane.
COPY --from=builder --chown=node:node /app/public ./public

# `standalone` already contains a pruned node_modules plus server.js.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Next.js writes its ISR/image cache here; pre-create it so the directory
# exists even when the root filesystem is mounted read-only and only
# /app/.next/cache is given a writable tmpfs.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next

USER node

EXPOSE 3000

# /api/health reports process liveness plus database and Redis reachability.
# `--spider` issues a GET and discards the body; any non-2xx exits non-zero.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
