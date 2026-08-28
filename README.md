# Karo

**Build anything with an AI agent that has a real computer.**

Karo is a cloud platform with a built-in AI coding agent. The agent chats with you, reads and
writes your project files, runs shell commands in an isolated sandbox, connects MCP servers,
installs skills and plugins, and reports every token and compute-second it spends.

It runs end to end with **zero external credentials** — a fresh clone boots into demo mode on
simulated providers, and real integrations switch themselves on when you supply keys.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> and sign in as `demo@karo.local` / `karo-demo-2025`.

---

## Table of contents

- [What you get](#what-you-get)
- [Architecture](#architecture)
- [Technology choices](#technology-choices)
- [Project structure](#project-structure)
- [Running locally](#running-locally)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Demo mode](#demo-mode)
- [Integrations](#integrations)
  - [Model providers](#model-providers)
  - [Stripe (billing)](#stripe-billing)
  - [Which sandbox to run](#which-sandbox-to-run)
  - [Daytona (cloud sandboxes)](#daytona-cloud-sandboxes)
  - [Local Docker sandboxes](#local-docker-sandboxes)
  - [Bring Your Own Server](#bring-your-own-server)
- [Pricing model](#pricing-model)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

---

## What you get

**Public site** — landing page with an interactive workspace demo, pricing with a live cost
estimator, features, docs, security, about, terms, privacy.

**Product** — dashboard, projects, an IDE-style agent workspace (chat, code, preview, terminal,
tasks, changes), sandbox management, MCP servers, a skills system, a plugin marketplace, usage
analytics, billing, API keys, team management, settings.

**Admin** — plans, model catalogue, providers, sandboxes, platform usage, unit economics,
incidents and the audit log. Every quota and price in the product is a row in the database,
editable from `/admin`, never hard-coded in a component.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   Browser ────────▶│  Next.js 16 (App Router, React Server         │
   SSE streams      │  Components + Route Handlers)                 │
                    │                                               │
                    │   /            marketing                      │
                    │   /app         product        ← session       │
                    │   /admin       platform admin ← platform role │
                    │   /api         route handlers                 │
                    └───────┬───────────────┬───────────────┬───────┘
                            │               │               │
                  ┌─────────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────┐
                  │ ModelProvider  │ │ Sandbox     │ │ BillingProvider │
                  │  · W&B         │ │ Provider    │ │  · Stripe       │
                  │  · +11 more    │ │  · Mock     │ │  · Mock         │
                  │  · Mock        │ │  · Docker   │ │                 │
                  └────────┬───────┘ │  · Daytona  │ └────────┬────────┘
                           │         │  · BYOS     │          │
                           │         └──────┬──────┘          │
                           │                │                 │
                  ┌────────▼────────────────▼─────────────────▼───────┐
                  │  PostgreSQL (Drizzle ORM)  ·  Redis (optional)    │
                  └───────────────────────────────────────────────────┘
```

### The agent loop

`src/lib/agent/runtime.ts` is the core. One pass is: ask the model → stream its text → run the
tools it called → feed the results back. Repeat until the model stops calling tools, the
iteration cap is reached, the user stops it, or something needs approval.

Everything the UI needs arrives as a typed `AgentStreamEvent` over Server-Sent Events, and the
same events are persisted — reloading a conversation reconstructs exactly what was shown.

SSE rather than WebSockets: the stream is strictly server→client, it survives HTTP/2
multiplexing and corporate proxies, and it reconnects for free.

### Three layers of authorisation

| Layer              | Question it answers                      | Code                          |
| ------------------ | ---------------------------------------- | ----------------------------- |
| **Team RBAC**      | May _this user_ do this in this team?    | `src/lib/rbac/permissions.ts` |
| **Agent policy**   | May _the agent_ do this in this project? | `src/lib/agent/policy.ts`     |
| **Command policy** | Is _this specific command_ safe to run?  | `evaluateCommand()`           |

A developer may hold `terminal.use`, while this project's agent is still forbidden from
installing packages, and `rm -rf /` is denied regardless of either.

---

## Technology choices

| Choice                                             | Why                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js 16 / React 19**                          | One deployable for marketing, product, admin and API. Server Components keep the data layer off the client and out of the bundle.       |
| **TypeScript strict + `noUncheckedIndexedAccess`** | Money and quotas are involved. `array[0]` being `T \| undefined` has caught real bugs here.                                             |
| **Tailwind v4 (CSS-first)**                        | The design tokens live in one `@theme` block in `globals.css`; there is no second config file to drift from it.                         |
| **Drizzle over Prisma**                            | SQL-shaped queries, no separate schema language, no query engine binary, and migrations are plain readable SQL.                         |
| **postgres.js**                                    | Faster than `pg` and its tagged-template API keeps raw SQL honest where Drizzle's builder gets in the way (the usage rollups).          |
| **scrypt from `node:crypto`**                      | Memory-hard like argon2 but with no native module to compile — `npm install` works on Windows and Alpine without a toolchain.           |
| **Radix + CVA, not a component kit**               | Karo needed its own identity. Radix supplies the accessibility primitives; the styling is entirely ours.                                |
| **Redis optional**                                 | A dev clone should not need it. Without `REDIS_URL` the rate limiter and cache transparently fall back to an in-process implementation. |
| **Integer micro-USD for money**                    | Per-token costs are far below a cent; cents would round margin to zero. Every column ending `MicroUsd` is 1e-6 USD.                     |

---

## Project structure

```
src/
  app/
    (marketing)/       public site
    (auth)/            login, register, password reset, verify
    app/               authenticated product
      projects/[id]/   the agent workspace
      onboarding/      first-run wizard
    admin/             platform admin
    api/               route handlers (REST + SSE)
  components/
    ui/                Karo UI primitives (Radix + CVA)
    brand/             logomark, wordmark, lattice
    marketing/         landing sections
    app/               product shell
    workspace/         IDE panes
    admin/             admin widgets
  lib/
    db/                schema, client, seed
    auth/              sessions, guards, service
    crypto/            AES-256-GCM secrets, scrypt passwords
    pricing/           weighted tokens, compute units, settlement
    usage/             metering and reporting
    rbac/              team permissions
    agent/             policy, tools, prompt, runtime
    ai/                model provider adapters (OpenAI-compatible + mock)
    sandbox/           sandbox providers, worker bus
    billing/           billing providers
    mcp/               MCP connection manager
    api/               route-handler helpers
  i18n/                en.json, ru.json
worker/                Bring-Your-Own-Server agent (single file, no deps)
docker/                sandbox base image, postgres init
drizzle/               generated SQL migrations
tests/                 unit, integration, e2e
```

---

## Running locally

### Requirements

- Node.js 20.11+ (developed on 24)
- PostgreSQL 15+
- Docker (optional — only for real sandboxes; demo mode does not need it)
- Redis (optional)

### Steps

```bash
cp .env.example .env      # works unchanged: everything falls back to a mock
docker compose up -d      # postgres + redis
npm install
npm run db:migrate        # apply SQL migrations
npm run db:seed           # plans, models, skills, plugins, demo workspace
npm run dev
```

`npm run db:seed` is idempotent — run it as often as you like.

Seeded accounts:

| Account                                      | Email              | Password          |
| -------------------------------------------- | ------------------ | ----------------- |
| Demo user (Pro plan, populated workspace)    | `demo@karo.local`  | `karo-demo-2025`  |
| Platform admin (Ultra plan, `/admin` access) | `admin@karo.local` | `karo-admin-2025` |

Change these with `SEED_DEMO_PASSWORD` / `SEED_ADMIN_PASSWORD`.

### Without Docker

If you already run Postgres, skip `docker compose up` and point `DATABASE_URL` at it. Redis is
optional — leave `REDIS_URL` unset and the in-process limiter takes over.

### Scripts

| Command                                                     | Purpose                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| `npm run dev`                                               | Development server                       |
| `npm run build` / `npm start`                               | Production build and serve               |
| `npm run typecheck`                                         | `tsc --noEmit`                           |
| `npm run lint`                                              | ESLint                                   |
| `npm test`                                                  | Vitest (unit + integration)              |
| `npm run test:e2e`                                          | Playwright                               |
| `npm run verify`                                            | typecheck → lint → test → build          |
| `npm run db:generate`                                       | Generate a migration from schema changes |
| `npm run db:migrate` / `db:seed` / `db:reset` / `db:studio` | Database tasks                           |

---

## Environment variables

Every variable is documented in [`.env.example`](.env.example). **The file works unchanged** —
copying it gives you a complete demo-mode install.

The ones that matter:

| Variable                              | Required      | Effect when absent                                       |
| ------------------------------------- | ------------- | -------------------------------------------------------- |
| `DATABASE_URL`                        | yes           | Defaults to `postgresql://karo:karo@localhost:5432/karo` |
| `ENCRYPTION_KEY`                      | in production | Development fallback; BYOK keys still encrypted          |
| `REDIS_URL`                           | no            | In-process rate limiting and cache                       |
| any provider key (`WANDB_API_KEY`, …) | no            | **Mock model provider** (demo mode)                      |
| `STRIPE_SECRET_KEY`                   | no            | **Mock billing provider**                                |
| `STRIPE_WEBHOOK_SECRET`               | with Stripe   | Webhooks are rejected rather than trusted                |
| `DAYTONA_API_KEY` + `DAYTONA_API_URL` | no            | Daytona provider disabled                                |
| `DOCKER_SOCKET`                       | no            | Local Docker provider disabled                           |
| `KARO_DEMO_MODE`                      | no            | Forces every provider to its mock                        |

Generate the secret:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
```

In production `ENCRYPTION_KEY` is **required** — the app refuses to serve requests without it. It
is deliberately not required during `next build`, so it never has to enter a CI or Docker build
environment.

There is only one secret because there only ever was one. `AUTH_SECRET` and `BYOS_TOKEN_SECRET`
were documented here as signing keys, required in production, and read by nothing: sessions, CSRF
tokens and BYOS worker tokens are long random strings persisted only as SHA-256 digests, so no
signing key takes part. Rotating them ended no session and revoked no token. Both have been
removed.

---

## Database

42 tables covering identity, teams, projects and files, conversations, messages, agent runs and
tool calls, sandboxes and sessions, terminals, BYOS workers, providers, models and price
history, BYOK keys, MCP servers and tools, skills, plugins, plans, subscriptions, balances,
top-ups, invoices, usage and compute events, period rollups, audit events, notifications,
incidents and admin settings.

Two conventions worth knowing:

- **IDs are prefixed and time-sortable** (`prj_...`, `sbx_...`). Self-describing in an audit
  log, and lexicographic order matches creation order so btree indexes stay tight.
- **Prices are append-only.** A price change closes the current `model_prices` row
  (`effective_to`) and inserts a new one, so an invoice from last month can still be
  reconstructed from the price that applied then.

Changing the schema:

```bash
# edit src/lib/db/schema.ts
npm run db:generate
npm run db:migrate
```

---

## Demo mode

Karo runs without any model provider, Daytona or Stripe. `env.DEMO_MODE` is true when no real
credentials are configured, and each provider falls back independently — a real `WANDB_API_KEY`
with no Stripe key gives you real models and simulated billing.

| Surface     | Simulated behaviour                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI**      | `MockProvider` streams token-by-token with realistic plans, tool calls and usage. Deterministic, so E2E tests can assert on it.                                                     |
| **Sandbox** | `MockSandboxProvider` implements a real in-memory filesystem and a POSIX-ish shell (`ls`, `cd`, `cat`, `grep`, `mkdir`, `rm`, `git`, `npm`…). It is honest about what it cannot do. |
| **Billing** | `MockBillingProvider` creates real subscription and invoice rows and moves real balances — it just skips the payment network.                                                       |
| **Email**   | Verification and reset links are printed to the server log.                                                                                                                         |

The UI labels demo mode explicitly and says which providers are simulated. Nothing pretends to
be real.

---

## Integrations

### Model providers

Every provider Karo talks to speaks **OpenAI-compatible Chat Completions**, so a provider is a
data entry rather than an adapter: the registry in
[`src/lib/ai/providers/descriptors.ts`](src/lib/ai/providers/descriptors.ts) is the single source
of truth for base URLs, credential variable names and the `AI_PROVIDER=auto` preference order.

Turning one on means setting one key and restarting:

```bash
WANDB_API_KEY=your-key-here      # the default — cheapest capable option
# AI_PROVIDER=auto               # (default) picks the best-value configured provider
```

`AI_PROVIDER=auto` resolves to the configured provider with the best value ranking. Pinning a
name (`wandb`, `deepseek`, `zai`, `openrouter`, `groq`, `cerebras`, `siliconflow`, `together`,
`gemini`, `mistral`, `moonshot`, `omniakey`, `ollama`) is honoured even when its credential is
missing — Karo logs a warning rather than silently serving a different provider.

#### Which one to pick

Prices are USD per million tokens, verified against first-party pricing pages in July 2026. They
move; re-check before quoting them to anyone.

| Provider                    | Cheapest capable model           | Frontier option              | Why pick it                                                                                                     |
| --------------------------- | -------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **W&B Inference** (default) | gpt-oss-120b **$0.03 / $0.17**   | Qwen3-Coder-480B $1.00/$1.50 | Cheapest per token of any host measured here, 25 open models on one key, `$100/month` cap on the free plan      |
| **DeepSeek**                | V4-Flash $0.14 / $0.28 (1M ctx)  | **V4-Pro $0.435 / $0.87**    | The cheapest frontier tier anywhere — ~4× under the same model resold. Automatic caching cuts repeat input ~50× |
| **Z.ai**                    | **glm-4.7-flash $0 / $0**        | GLM-5.2 $1.40/$4.40          | The only genuinely free model with a 200K context and working tool calls                                        |
| **OpenRouter**              | 15 `:free` variants              | anything, one key            | Switch vendors without switching accounts                                                                       |
| **Groq / Cerebras**         | llama-3.1-8b-instant $0.05/$0.08 | —                            | Fastest tokens/sec, free tiers                                                                                  |
| **Ollama**                  | any local model                  | —                            | Zero bill; quality bounded by your hardware                                                                     |
| **Omniakey**                | —                                | Claude / GPT / Gemini / Grok | Only when you specifically need a closed frontier model                                                         |

Two things worth knowing before you choose:

1. **Data residency.** DeepSeek and Z.ai are the best value and both run on PRC infrastructure,
   so customer source code leaves your jurisdiction. Mistral is the EU-hosted alternative.
2. **Google's free tier trains on your input.** The Gemini API terms allow Google to use
   unpaid-tier content to improve its products and have humans review it. Do not point customer
   traffic at it; the paid tier is explicitly different.

#### W&B Inference specifics

Verified against the live API rather than inferred from documentation:

- Base URL `https://api.inference.wandb.ai/v1`, endpoint `POST /chat/completions`, auth
  `Authorization: Bearer <key>`. No `OpenAI-Project` header is needed.
- Streaming and **tool calling work on every one of the 25 seeded models**, including the
  reasoning ones, which stream their thinking in `delta.reasoning`.
- `stream_options: {include_usage: true}` returns real token counts on the final SSE frame, so
  metering records usage instead of estimating it.

Two caveats, also recorded in the seed file:

1. **No cache discount is published.** W&B lists input and output only, though its usage payload
   does report `cached_tokens`. Cached input is therefore priced at the _input_ rate rather than
   given an invented discount, so Karo charges exactly what the provider charges.
2. **Max output tokens are not published.** The seeded values were chosen after confirming the
   API accepts them, and are sized so a reasoning model has room to think _and_ still emit its
   tool call — too small a budget makes runs die at `finish_reason: length` before any tool runs.

Platform keys are **never** sent to the browser, and Karo deliberately does not expose a
general-purpose proxy endpoint — it is a product, not a resold API.

### Stripe (billing)

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Then set each plan's price IDs in **Admin → Plans** (`stripePriceIdMonthly` /
`stripePriceIdYearly`).

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Webhook signatures are verified with the raw body; an unverified webhook is rejected, never
"processed anyway in development". Every event id is recorded before it is acted on, because
Stripe retries deliveries and a replayed top-up is a real money bug.

### Which sandbox to run

The sandbox is usually the larger bill, because it is billed by the second the agent is awake
rather than by the token. Verified against first-party pricing pages in July 2026, at a common
**2 vCPU / 4 GB** spec:

| Host                                          | $/hour      | vs cheapest | Notes                                                                                                                            |
| --------------------------------------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Your own server** (BYOS, e.g. Hetzner CX23) | **$0.0104** | 1×          | Karo already supports this, and bills it at `computeMultiplier = 0`                                                              |
| Local Docker                                  | $0          | —           | Your own machine; the dev default                                                                                                |
| Fly.io Machines                               | $0.0309     | 3×          | Cheapest managed option, but Karo has no adapter for it yet                                                                      |
| Northflank                                    | ~$0.033     | 3×          | Best free tier of the managed hosts                                                                                              |
| Daytona                                       | $0.1656     | 16×         | **Karo has an adapter**; sub-90 ms starts, $200 free credits                                                                     |
| E2B                                           | $0.1656     | 16×         | Same price to the cent as Daytona, but its free tier caps a session at 1 hour — an agent that installs packages will exceed that |
| Cloudflare Containers                         | $0.074      | 7×          | Disk is ephemeral and snapshots are "coming soon", which breaks Karo's persistent workspace                                      |
| Modal                                         | $0.2380     | 23×         | Sandboxes carry a ~3× premium over Modal Functions                                                                               |

The short version: **run your own box** — it is 16× cheaper than the managed sandbox hosts and
Karo does not bill compute for it at all. Reach for Daytona when you want someone else to operate
the fleet.

### Daytona (cloud sandboxes)

```bash
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_API_KEY=your-key
```

Lifecycle endpoints (`POST /sandbox`, `/sandbox/{id}/start`, `/stop`, `DELETE /sandbox/{id}`)
are verified against Daytona's documentation. Command execution and file operations go through
Daytona's _toolbox_ surface, which their SDKs wrap; those paths are collected in one
`TOOLBOX_PATHS` constant in `src/lib/sandbox/providers/daytona.ts` so a Daytona API revision is
a one-place edit. If a toolbox call 404s, the provider fails loudly with an actionable message
rather than pretending the command ran.

### Local Docker sandboxes

```bash
DOCKER_SOCKET=/var/run/docker.sock     # prefer a ROOTLESS socket
docker build -t karo/sandbox-base:1 docker/sandbox-base
docker network create --internal karo-sandbox
```

Point `DOCKER_SOCKET` at a **rootless** Docker or Podman socket
(`$XDG_RUNTIME_DIR/docker.sock`). Karo never mounts that socket into a sandbox.

Every container gets: `Privileged: false`, `CapDrop: ALL`,
`SecurityOpt: no-new-privileges`, `ReadonlyRootfs` with tmpfs `/tmp`, hard memory / CPU / PID
limits, uid 10001, no bind mounts, and an `internal: true` network — which is what stops a
sandbox reaching cloud metadata endpoints.

### Bring Your Own Server

Run the agent on your own VPS, NAS or spare laptop. The connection is **outbound only**: no
inbound port, no public IP, no SSH credential given to Karo, and nothing about the machine
exposed to a browser.

1. **Settings → Servers → Register a server** issues a one-time installation token.
2. Run the worker on your machine:
   ```bash
   node worker/karo-worker.mjs --token <install-token> --url https://your-karo-host
   ```
3. The worker exchanges the install token for a long-lived worker token (the install token is
   burned immediately), reports its capabilities, then long-polls for work and posts results.
4. Revoke or rotate at any time from the same page.

`worker/karo-worker.mjs` is a single dependency-free Node file so it can be audited in one
sitting before anyone runs it on their infrastructure. `--dry-run` makes it a **mock worker**
that registers, polls and answers with simulated results — enough to exercise the whole BYOS
path without Docker installed.

Compute on your own server is **metered but never billed**; you are already paying for the
hardware.

---

## Pricing model

### Weighted tokens

Providers charge differently for input, output, cached-read and cache-write tokens, and those
ratios move whenever a catalogue refresh lands. A plan promising "6M tokens" would therefore be
worth wildly different amounts on two models. So plans promise **weighted** tokens:

```
1 input token = 1 weighted token
```

Every other class converts at its **current price ratio** against the same model's input price:

```
weighted = input×1  +  output×(out/in)  +  cached×(cached/in)  +  cacheWrite×(write/in)
```

On GPT-OSS 120B ($0.03 in / $0.17 out) an output token is worth 5.67 weighted tokens; on
Qwen3-Coder-480B ($1.00 / $1.50) it is worth 1.5. When a provider publishes new prices the
multipliers recompute automatically — no plan edits, no migration. The derivation string is shown
to the user on every response.

Models with no published input price fall back to documented ratios (output 4×, cached 0.1×,
write 1.25×) and are flagged **estimated** in the UI.

### Compute units

One **base compute hour** = one hour of 0.25 shared vCPU + 512 MB RAM + a standard disk.

```
compute multiplier = CPU multiplier × RAM multiplier × provider multiplier
```

A 1 vCPU / 2 GB machine is 4 × 4 = **16×**, so 100 included compute hours is 6.25 real hours on
it. The multiplier is always shown before a sandbox starts.

### Settlement

1. **BYOK** — you paid the provider directly; Karo charges nothing and does not touch your
   included credits.
2. **Included quota** — the subscription allowance, consumed first.
3. **Overage / PAYG balance** — priced at the plan's published overage rate, or at upstream cost
   plus margin when the plan sets none.

Every number — allowances, sandbox caps, RAM ceilings, margins, overage rates, auto-sleep
windows — is a column on the `plans` table, editable in `/admin/plans`. Nothing is hard-coded in
a component.

### Admission holds

A spending cap that only counts _finished_ runs is not a cap. `usage_periods` moves at settlement,
so runs started in the same second all read the same untouched counters, all conclude there is
room, and all take it — a team could exceed its cap and its PAYG credit limit by however many runs
it launched at once.

So starting a run does not merely check the budget, it **holds** it: admission takes a row in
`usage_reservations` inside a transaction that locks the period row, and the guard is evaluated
against `settled + already held + this estimate`. The hold is returned on every exit path,
including a client that disconnects mid-stream. A hold also carries a TTL, because a process killed
mid-run cannot hand its own back; expired holds stop counting immediately and are swept the next
time that team starts anything.

The hold is not drawn down as the run spends, so a run in flight counts as both its full estimate
and its usage so far. That over-counts on purpose: the only thing it can do is refuse a borderline
run that might have fitted, which is the right direction for a hard stop.

---

## Security

Implemented:

- Server-side secret storage; **AES-256-GCM encryption at rest** for BYOK keys, MCP secrets and
  plugin configuration
- scrypt password hashing (OWASP 2024 parameters), session tokens stored only as SHA-256 hashes
- Secure, httpOnly, sameSite cookies; **double-submit CSRF** plus same-origin checks
- Sliding-window rate limiting on auth, chat, terminal and sandbox creation
- Zod validation on every route input
- Team RBAC, agent permission matrix, and a command allow/deny policy
- Audit log on every mutation, with secrets redacted **before** insert
- Idempotency keys on webhooks and top-ups; Stripe signature verification
- **SSRF protection** — private, loopback, link-local and metadata addresses rejected; redirects
  re-validated per hop
- **Path traversal protection** — every agent and user path passes `normalizeWorkspacePath()`.
  An absolute path outside `/workspace` is rejected, not silently reinterpreted as relative
- Sandbox isolation: unprivileged, capability-dropped, resource-capped, network-isolated
  containers; the host Docker socket is never mounted
- **Prompt-injection defence** — file contents, command output and fetched pages are treated as
  data. Tool output is redacted, bounded, and instruction-shaped text is neutralised before it
  re-enters the model context
- Destructive actions require explicit approval, even in Auto mode
- Content Security Policy, HSTS, `X-Content-Type-Options`, `frame-ancestors: none`
- No `eval`. No secrets in the client bundle. No unauthenticated sandbox endpoints.

**Not implemented:** SSO/SAML (the architecture is in place, no IdP is wired), silent user
impersonation (deliberately omitted), and hardware-backed key management — `ENCRYPTION_KEY` is
an environment variable, so use a KMS-backed secret store in production.

---

## Testing

```bash
npm test                # unit + integration
npm run test:e2e        # Playwright
npm run verify          # typecheck → lint → test → build
```

- **Unit** (`tests/unit/`) — weighted-token calculator, compute units, settlement and spend
  guards, RBAC, agent command policy and path traversal, crypto and redaction, the mock sandbox
  adapter.
- **Integration** (`tests/integration/`) — metering against a real Postgres. These deliberately
  do not mock the driver: the thing under test _is_ the transaction, where an event row, a
  period rollup and a balance movement must all land or none do.
- **E2E** (`tests/e2e/`) — Playwright smoke, onboarding and slash-command specs.

Integration tests need a database. Point them at a throwaway one — the suite writes rows and
cleans up after itself, but it is not something to aim at data you care about:

```bash
DATABASE_URL=postgresql://karo:karo@localhost:5432/karo_test npm test
```

If you would rather not prefix every run, put it in `.env.test.local` (gitignored):

```bash
DATABASE_URL=postgresql://karo:karo@localhost:5432/karo_test
```

`tests/setup.ts` reads `.env.test.local` and `.env.test`, and nothing else. It deliberately
ignores `.env` and `.env.local`: those point at your development database, and an integration
run that quietly truncated the data you were working with would be a nasty surprise. A
`DATABASE_URL` already exported in the environment always wins, which is how CI reaches its
service container without a file existing at all.

Everything else the suites need is fixed in `tests/setup.ts` — mock providers everywhere, a
committed encryption key so ciphertext is byte-identical on every machine, and `TZ=UTC` so
formatted timestamps do not depend on the runner's locale.

---

## Deployment

### Vercel, free tier (demo mode)

The whole platform deploys on free hosting in demo mode — Vercel for the app,
Neon for Postgres, one consolidated cron endpoint for the sweeps. **[DEPLOY.md](./DEPLOY.md)**
is the step-by-step guide; `vercel.json`, `.env.production.example`,
`scripts/smoke.mjs` and the `production.yml` workflow it references are all in
the repo. Read its "What the free tier does NOT do" section before pointing
real users at it.

### Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Hetzner reference architecture

```
                        ┌────────────────────────┐
   Internet ───────────▶│  Load balancer (TLS)   │
                        └───────────┬────────────┘
                                    │  public
                     ┌──────────────▼───────────────┐
                     │  Control plane (CPX31+)      │
                     │  Next.js · Postgres · Redis  │
                     └──────────────┬───────────────┘
                                    │  private network only
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
      ┌───────▼──────┐      ┌───────▼──────┐      ┌───────▼──────┐
      │ Sandbox node │      │ Sandbox node │      │ Sandbox node │
      │ rootless     │      │ rootless     │      │ rootless     │
      │ Docker       │      │ Docker       │      │ Docker       │
      └──────────────┘      └──────────────┘      └──────────────┘
```

- Only the load balancer has a public IP. Sandbox nodes have **no public ingress** and reach the
  control plane over the Hetzner private network.
- Sandbox containers attach to an `internal: true` network, so egress and metadata endpoints are
  blocked at the network layer rather than only by policy.
- Postgres uses a Hetzner Volume with automated snapshots; Redis is ephemeral by design.
- Scale sandbox nodes horizontally; the control plane is stateless apart from the terminal and
  worker buses, which are sticky-routed per sandbox and per worker.

### Checklist before going live

- [ ] Set `ENCRYPTION_KEY` from a secret manager, not a `.env` file
- [ ] Set `APP_URL` to the public origin
- [ ] Point `DOCKER_SOCKET` at a **rootless** socket, or use Daytona
- [ ] Create the `karo-sandbox` network with `--internal`
- [ ] Build and publish `karo/sandbox-base:1`
- [ ] Verify model ids and prices in `/admin/models` and run a catalogue sync
- [ ] Configure Stripe price IDs in `/admin/plans` and register the webhook
- [ ] Review `/terms` and `/privacy` with counsel — they ship as templates
- [ ] Set `LOG_LEVEL=info` and ship logs somewhere durable

---

## Known limitations

Stated plainly, because a list of caveats is more useful than a list of claims.

1. **Real sandbox execution needs Docker or Daytona.** Without either, Karo uses the in-memory
   simulator. It is genuinely useful for exploring the product, but it does not compile your
   code.
2. **Daytona's toolbox paths are a best-effort mapping.** Lifecycle endpoints are verified; the
   exec/file paths are isolated in one constant and fail loudly rather than silently.
3. **Omniakey model id spelling** may need a catalogue sync on first run — see above. This does
   not affect the default W&B catalogue, whose ids were read from the live `/v1/models` response.
4. **Cached input is billed at the input rate on W&B**, which publishes no cache discount. That
   is exact rather than estimated, but it means long conversations get no cache saving there —
   DeepSeek, which publishes a ~50× cache-hit discount, is cheaper for that shape of work.
   The Omniakey rows do still use estimated cache ratios, flagged in the UI.
5. **The worker bus is single-node.** A multi-node control plane needs sticky routing per
   `workerId`; that belongs in the ingress layer and is not implemented here.
6. **The Daytona provider's terminal is line-mode**, not a PTY. Interactive programs (vim, top)
   need the Docker or BYOS provider.
7. **OAuth is architected, not enabled.** The `accounts` table and the flow exist; no IdP is
   wired, and the buttons are visibly disabled rather than fake.
8. **No background job runner — scheduling is yours.** Karo ships no in-process timer, because a
   `setInterval` cannot survive a serverless invocation and would run N times over N replicas.
   Everything periodic is an idempotent endpoint instead, and each one accepts either a platform
   admin's session or `Authorization: Bearer $CRON_SECRET`:

   | Endpoint                               | What stops working without it                                                                       |
   | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
   | `POST /api/admin/sandboxes/sweep`      | Idle sandboxes never sleep and are never destroyed — customers are billed for the whole idle window |
   | `POST /api/cron/billing/auto-topup`    | A team that has already run dry never refills, because nothing meters and nothing triggers          |
   | `POST /api/cron/billing/apply-pending` | Scheduled downgrades never land, so the team keeps the higher plan                                  |
   | `POST /api/admin/models/sync`          | Model prices drift from the provider's                                                              |

   Point any scheduler at them. If `CRON_SECRET` is unset they still work, but only from an admin
   session — which means nothing periodic actually happens.

9. **Email is console-only** by default. `EMAIL_TRANSPORT=smtp` is a documented seam, not a
   shipped transport — no mail dependency is bundled.
10. **Storage quotas are tracked, not enforced** at the filesystem level; the per-sandbox disk
    limit is enforced by the container runtime, not by Karo.
11. **The UI is English-only; localisation is the architecture, not the content.**
    `src/lib/i18n.ts` is a complete translator — dot-path keys typed against the dictionary,
    parameter interpolation, `Accept-Language` negotiation — and `src/i18n/` holds `en.json` and
    `ru.json`. What is missing is the call sites: components hold their copy inline, so choosing
    Russian in Settings stores the preference without changing what you see. Wiring it up is
    mechanical but touches every component, and half-translating a product reads worse than not
    translating it.

---

## Licence

Provided as-is for evaluation. Review `/terms` and `/privacy` with counsel before commercial use.
