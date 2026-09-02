# RUN-EVIDENCE — production-readiness iteration (2026-08-28)

Per-workspace rule: command → exit code → file set → logs summary for this run.

## Baseline

| Check | Result |
| --- | --- |
| `npm run verify` (before changes) | **exit 0** — format, typecheck, lint, 25 files / 386 tests, build. First run's `ECONNREFUSED 127.0.0.1:5433` was an environment fault (no test DB running), not a code fault: the pipe masked the exit code, re-run after the DB fix below was fully green. |
| Audit (read-only sweep over src/, tests/, configs) | security headers, rate limiting on every auth route, `/api/health`, cron auth helper, sitemap/robots/OG/JSON-LD, all three error boundaries, structured logging — **already present**. Genuine gaps: no git repo, no Vercel deploy path, no consolidated cron endpoint, unused `jose` dep, `db:seed` broken outside Next. |

## Environment fixes (no repo changes)

| Command | Exit | Outcome |
| --- | --- | --- |
| `wsl -u root -e sh -c "pg_createcluster 18 karo -p 5433 …"` | 0 | Dedicated Postgres 18 cluster in WSL on port 5433, `listen_addresses='*'`, `pg_hba` allows 172.16.0.0/12. Reason: no Docker on the machine and the WSL `wslrelay` localhost forwarding to the existing 5432 cluster proved **unreliable** (intermittent `ECONNREFUSED`). Direct connections to the WSL VM IP bypass the relay: 3/3 probes OK. |
| role `karo` / databases `karo_test`, `karo` on that cluster | 0 | Owned by `karo`, isolated from all pre-existing databases. |
| `wsl.exe -e sh -c "sleep 3600"` (background keep-alive) | running | WSL networking drops connections once no WSL session is active; the keep-alive holds the VM warm for the duration of the runs. |
| `.env.test.local` (gitignored, machine-local) | — | Points at `postgresql://karo:karo@172.22.141.215:5433/karo_test`. The IP changes if WSL restarts (`wsl hostname -I`). |

## Changes (committed, in order)

| Commit | Files | Verification |
| --- | --- | --- |
| `0dc7ac0 chore: import Karo platform baseline` | whole tree as found | baseline verify green |
| `dac89ee feat(cron): consolidated maintenance tick endpoint` | `src/app/api/cron/tick/route.ts`, `src/lib/audit.ts`, `tests/unit/api/cron-tick.test.ts` | `npx vitest run tests/unit/api/cron-tick.test.ts` → 4/4 passed |
| `6c862d7 feat(security): refuse production seed with documented default passwords` | `src/lib/db/seed.ts` | covered by typecheck + full suite |
| `4ee0679 chore(deps): remove unused jose dependency` | `package.json`, `package-lock.json` | zero imports confirmed by grep over `src/`, `worker/`, `tests/` |
| `52f8e97 feat(deploy): free-tier Vercel deployment path` | `vercel.json`, `.env.production.example`, `DEPLOY.md`, `README.md`, `.github/workflows/production.yml`, `scripts/smoke.mjs`, `PROMPT-PRODUCTION.md`, `.gitignore` | smoke script syntax-checked by Node; workflow mirrors existing `ci.yml` conventions |
| `063cfc2 fix(db): make standalone db scripts resolve server-only` | `package.json`, `package-lock.json`, `tsconfig.scripts.json` | `npm run db:seed` against a fresh database → completed, dataset loaded (was: `MODULE_NOT_FOUND: server-only` / RSC guard throw — the repo's own documented seed flow was broken outside Next) |
| `2555ada test(e2e): make the suite pass on a fresh database, not just the author's` | `src/lib/db/seed.ts`, `tests/e2e/smoke.spec.ts`, `playwright.config.ts` | targeted reruns: servers-panel spec → passed with the seeded worker; smoke admin-area spec → passed with the corrected assertion |

## E2E investigation (what the runs surfaced)

| Run | Setup | Result | Finding |
| --- | --- | --- | --- |
| 1 | fresh DB, default config | 22 passed / 2 failed | tail of the suite died on `auth.login` 429s: the whole run signs in from one IP as one account, exhausting the 10-per-5-min bucket |
| 2 | same DB (residue) | 22 passed / 22 failed | onboarding re-registration hit 409 conflicts — the suite needs a fresh database, like CI's service container |
| 3 | fresh DB | 37 passed / 7 failed | same tail-rate-limiting plus two genuine spec bugs (below) |
| 4 | fresh DB, `--retries=2` | 29 passed, 5 flaky, 4 failed | failures isolated to onboarding ×2, servers-panel, smoke admin-area |
| 5–8 | fresh DB + CI-equivalent env, `--workers=2` | servers-panel and smoke admin-area fixed; onboarding ×2 remain machine-speed | final state |

Two genuine bugs were found and fixed through this:

1. **`smoke.spec.ts` admin-area check asserted the wrong contract.** `requirePlatformAdmin()` throws `notFound()` from the admin layout — after Next has started streaming the shell, so the not-found page arrives with HTTP **200**, both in `next dev` and in a production `next start` build (verified manually against both). The access control itself holds: the body was the 404 page with zero console content. The spec now asserts that contract: 404 status or the not-found page, and no admin-console content (`Unit economics`) in the body. A `generateMetadata` pre-stream guard was prototyped to restore the 404 status and reverted — it did not change the status (streaming still commits first) and doubled the session lookup.
2. **`servers-panel` depended on state the seed never created.** The panel renders one card per enrolled BYOS machine; with an empty `byos_workers` table (what a fresh database — and CI — seeds) the `Container runtime:` line never renders anywhere. The seed now ships one online worker with deliberately no capabilities (the "enrolled before installing Docker" shape the line exists to surface).

Onboarding wizard specs (`walks the onboarding wizard…`, `creates a project from a starter template`) remain timing-sensitive: their first navigation crosses the cold Turbopack compile of the workspace route (Monaco + xterm), which exceeds their timeouts on this loaded Windows machine. They pass intermittently here and are the CI gate's to judge on a fast runner.

## Final verification

| Check | Result |
| --- | --- |
| `npm run verify` (after all changes) | **exit 0** — format, typecheck, lint, 26 files / **390 tests passed** (386 baseline + 4 new tick tests), production build green |
| `DATABASE_URL=…@172.22.141.215:5433/karo npm run db:migrate` | exit 0 — 3 migrations, 43 tables |
| `DATABASE_URL=…@172.22.141.215:5433/karo npm run db:seed` | exit 0 — providers, models, plans, admin + demo accounts, BYOS worker fixture |
| `npx playwright test` (targeted reruns after the fixes) | servers-panel and the full smoke spec pass; onboarding wizard specs are timing-sensitive on this machine's cold dev compiles — CI is the deterministic gate for them |
| Production-build sanity (`next start`) | `/api/health` → 200 (DB live), `/` → 200, `/admin` as demo → not-found page, no console content in the body |

## Known limitations left deliberately (from the project's own list)

- Free-tier deployment runs `SANDBOX_PROVIDER=mock`: workspace works, code does not execute. Real execution = BYOS worker on your machine (documented in DEPLOY.md step 9).
- Vercel Hobby is non-commercial and caps function duration; its cron fires daily — hence the consolidated tick plus the optional hourly GitHub Actions ping.
- `CRON_SECRET` / `TRUST_PROXY_HOPS` are read from `process.env` rather than the zod env schema — intentional in the codebase (optional infra config), left as-is and documented here.
- Rate limiter stays fail-open on Redis errors — the codebase's documented trade-off.

---

# Iteration: CLI agents, MCP in the loop, workspace resilience (2026-09-02)

Second documented run: four feature/fix cycles, each ending in verify + live
browser + API testing + push (Vercel deploys from `main`).

## Baseline

| Check | Result |
| --- | --- |
| `npm run typecheck` + `npx vitest run` | **exit 0** — 30 files / 414 tests. First run failed 28 integration tests with connect timeouts: the WSL Postgres VM had gone idle and Windows→WSL NAT dropped the wake-up connections. `wsl hostname -I` (any `wsl.exe` call) wakes it; a `while true; do sleep 15; done` keep-alive runs for the duration of the session. |

## Cycles

| Commit | Cycle | Verification beyond `npm run verify` |
| --- | --- | --- |
| `1feb210` cli agents: installable terminal coding agents | Catalogue of 8 vendor-documented tools (`cli_tools` + `sandbox_cli_installs`, migration 0007, seeds), install/check/launch API, workspace dialog, `/admin/cli-tools`. Also: metrics-polling tight-loop fix. | curl: login → create sandbox → check=missing → exec install → check=installed `claude 1.0.0` → launch opens titled session with launcher script. Browser: install from the dialog flips the badge via the 4s auto-check; machine-OS tab prints per-OS commands; admin toggle hides the tool from the user catalogue (8→7→8). Playwright: new `cli-agents.spec.ts` 2/2. |
| `f82f73a` agent runtime: wire MCP tools into the loop | `loadToolsForProject` merged into the run's tool list (cap 40), `source: 'mcp'` persistence, approval flow routed through `callTool`, prompt summary. | Unit 3/3 (approval gate, hand-off, error mapping). Integration 4/4 against a real stdio MCP server (discovery, namespacing, destructive routing, end-to-end call). Live: build-mode run on Qwen3-Coder via W&B called `mcp__echo_server__echo` and reported the echoed text. |
| `30097c6` sandbox: make simulated machines survive a restart | `rehydrateProvider` feeds the row shape to the simulator; queues share the globalThis store; `queue.next()` races the abort signal so the scrollback flush always fires on detach. | Restarted the dev server mid-session: terminals reconnect without "Reconnecting…", `echo` output lands in the `terminal_sessions.scrollback` row (was: 0 bytes, permanent reconnect loop). |
| `416ba38` admin: quick actions on the overview page | Three idempotent maintenance buttons (cron tick, idle sweep, model sync) with toasts + `router.refresh`. | `/admin` was completely dead — the platform-counts query passed a raw `Date` into `sql\`\`` and postgres.js rejected it (ERR_INVALID_ARG_TYPE), 500 behind the error boundary on every render. Fixed with an ISO-string parameter; browser: page renders, all three buttons return 200 with toasts. |

## Notes for the next iteration

· The e2e suite defaults to `PLAYWRIGHT_BASE_URL=http://localhost:3000`; on
  this machine port 3000 is another project, so run e2e against the dev server
  on 3001 with the env var.
· `MCP_STDIO_ALLOWED_COMMANDS=node` is test-only; production keeps the
  `npx`/`uvx` default.
· i18n (RU/EN) remains the biggest unplumbed surface: dictionaries and
  `src/lib/i18n.ts` exist, no call sites are wired.
