# Deploying Karo for free

The shortest honest summary: **Karo runs end to end on free tiers** because it
boots in demo mode — mock AI, mock billing, in-memory sandboxes, no external
credentials. This document walks through the whole deploy. Steps 1–7 are
one-time; step 8 is optional polish. Every step that needs *your* accounts is
marked **[YOU]**; everything else is already automated by files in this repo.

```
   Browser ──▶ Vercel (free)          Next.js 16, demo mode
                  │
                  ├──▶ Neon (free)    PostgreSQL — migrations from ./drizzle
                  ├──▶ Vercel Cron    GET /api/cron/tick (daily on the free plan)
                  │     + GitHub      hourly tick via .github/workflows/production.yml
                  └──▶ mock providers AI · billing · sandbox (zero credentials)
```

**Total cost: $0.**

## What the free tier does NOT do — read this once

Stated plainly, because surprises after a deploy are worse than before it:

1. **Vercel Hobby is non-commercial.** Fine for a portfolio, a demo, a product
   showcase. If you charge money through this deployment, move to Vercel Pro or
   the Hetzner architecture in the README — Stripe plus Hobby violates Vercel's
   fair-use policy.
2. **Sandboxes are simulated.** `SANDBOX_PROVIDER=mock` — the workspace, agent
   chat, tasks and diffs all work, but code does not actually compile or run.
   Real execution comes free from a BYOS worker on your own machine (step 9).
3. **Serverless function duration is capped.** Long agent runs get cut off by
   the platform. Demo conversations are fine; marathon sessions are not a
   free-tier shape of work.
4. **Vercel cron fires once per day on Hobby.** That is why
   `vercel.json` schedules one consolidated tick (`/api/cron/tick`), and why
   the optional GitHub Action pings it hourly instead — free, and closer to
   what an operated deployment wants.

## Prerequisites — [YOU]

Three accounts, all free: **GitHub**, **Vercel** (sign in *with GitHub*), and
**Neon** (sign in *with GitHub*). Nothing else.

## 1 — Push the repository to GitHub — [YOU]

The repository is already initialised locally with the deploy files committed.

```bash
git remote add origin git@github.com:<you>/karo.git   # or the https URL
git push -u origin main
```

Vercel deploys from this repo from now on: every push to `main` is built and
released automatically.

## 2 — Create the Neon database — [YOU]

1. Neon console → **New project** (any name; region *close to you*, e.g. AWS
   Eu-Central/Frankfurt for Europe).
2. Copy the **pooled connection string** (it contains `-pooler`):
   `postgresql://<user>:<password>@ep-…-pooler…neon.tech/neondb?sslmode=require`

Keep this URL; step 4 and step 5 both use it.

## 3 — Import the repo into Vercel and set env vars — [YOU]

1. Vercel → **Add New… → Project** → import the repo. Framework preset
   **Next.js** is detected; do not change build settings.
2. Before the first deploy, open **Environment Variables** and add the set
   below. The authoritative template with commentary is
   **`.env.production.example`** — copy values from there, not from memory.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<your-project>.vercel.app` (Vercel shows the domain) |
| `DATABASE_URL` | the Neon pooled URL from step 2 |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 24` |
| `KARO_DEMO_MODE` | `true` |
| `KARO_ALLOW_DEMO_LOGIN` | `true` |
| `SANDBOX_PROVIDER` | `mock` |
| `RATE_LIMIT_DISABLED` | `false` |
| `TRUST_PROXY_HOPS` | `1` |
| `LOG_LEVEL` | `info` |
| `SEED_ADMIN_EMAIL` | your email |
| `SEED_ADMIN_PASSWORD` | random — the seed **refuses** the documented defaults in production |
| `SEED_DEMO_PASSWORD` | random |

3. **Deploy.** The first build takes a few minutes. Done — the site is live.

## 4 — Migrate the database

Pick either; both run the same idempotent migrations.

**Option A — one command from your machine** (the DATABASE_URL is the Neon
pooled URL):

```bash
DATABASE_URL="postgresql://…pooler…neon.tech/neondb?sslmode=require" npm run db:migrate
```

**Option B — automatic on every push.** Put the same URL into GitHub →
Settings → Secrets and variables → Actions as `KARO_DATABASE_URL`. The
`production.yml` workflow migrates after each push to `main` and stays
transparently skipped while the secret is absent.

## 5 — Seed the demo dataset

From your machine (uses the same `SEED_*` values you set in Vercel):

```bash
NODE_ENV=production \
SEED_ADMIN_EMAIL="you@example.com" \
SEED_ADMIN_PASSWORD="<random>" \
SEED_DEMO_PASSWORD="<random>" \
DATABASE_URL="postgresql://…pooler…neon.tech/neondb?sslmode=require" \
npm run db:seed
```

This creates your **admin** account (email + `SEED_ADMIN_PASSWORD`) and the
public **demo** account behind the one-click login.

## 6 — Wire the hourly tick (optional, recommended)

In GitHub → Settings → Secrets and variables → Actions add:

- `KARO_BASE_URL` — `https://<your-project>.vercel.app`
- `KARO_CRON_SECRET` — the same value as Vercel's `CRON_SECRET`

The workflow then pings `/api/cron/tick` every hour: idle sandboxes sleep,
balances refill, scheduled downgrades land. Without it those sweeps run only
on the daily Vercel cron; without `CRON_SECRET` anywhere, they only run when a
platform admin presses the button.

## 7 — Verify

```bash
BASE_URL="https://<your-project>.vercel.app" node scripts/smoke.mjs --demo
```

Green means: health is live, the landing page renders, robots/sitemap serve,
a visitor can sign in to the demo account and reach the workspace. Also open
`https://<your-project>.vercel.app/api/health` in a browser once — it reports
each subsystem by name.

## 8 — Optional upgrades, still free

- **Custom domain** — Vercel → Settings → Domains. Point DNS per its
  instructions, then update `APP_URL` in Vercel.
- **Shared rate-limiting / cache** — Upstash free tier; set `REDIS_URL`.
- **Real sign-up emails** — Resend free tier via any SMTP bridge; set
  `EMAIL_TRANSPORT=smtp` and `SMTP_URL` (console transport only prints links
  into Vercel's function logs).

## 9 — Real code execution without paying (BYOS)

The workspace is honest about the simulator; when you want the agent to
actually run code, start the worker on your own machine — Karo never needs an
open port or a credential for it:

```bash
node worker/karo-worker.mjs   # interactive registration; token comes from
                              # Settings → Servers in your Karo deployment
```

Then pick the BYOS sandbox provider in `/admin` → providers. See the README's
*Bring Your Own Server* section for the security model.

## Updating

`git push` — Vercel rebuilds, `production.yml` migrates if configured. Migrations
in this repo are additive by project rule, so a push is safe by construction.
If a deploy ever looks wrong, `https://…/api/health` and Vercel's function logs
(name the subsystem, not the address) are the first two places to look.

## Troubleshooting

| Symptom | Usual cause |
| --- | --- |
| `/api/health` → 503 | `DATABASE_URL` wrong, or migrations not applied (step 4) |
| Demo login says the database was never seeded | step 5 not run, or run against a different database |
| First build fails on `ENCRYPTION_KEY` | the variable is missing or not 32 bytes when base64-decoded |
| Sweeps never seem to run | `CRON_SECRET` unset in Vercel, or secrets missing in GitHub (step 6) |
| Sign-up emails never arrive | console transport is active; set SMTP (step 8) |
