import { skills } from '@/lib/db/schema';

/**
 * Official skills that ship with Karo.
 *
 * A skill is a *system-prompt fragment*, not a wrapper: `instructions` is
 * concatenated into the agent's system prompt verbatim when the skill is
 * enabled for a run. Write it as if talking to the agent, keep it specific,
 * and never restate the platform rules the runtime already enforces.
 *
 * `allowedTools` narrows what the agent may call while the skill is active;
 * the per-project permission matrix in `@/lib/agent/policy` still applies on
 * top, so a skill can never widen what the project allows.
 *
 * A `slashCommands` name must not collide with the built-in registry in
 * `@/components/workspace/slash-commands`: `buildSlashCommands` keeps the
 * built-in and drops the contributed command, so a colliding name silently
 * means the skill's prompt never runs.
 */
export type SkillSeed = Omit<
  typeof skills.$inferInsert,
  'id' | 'ownerTeamId' | 'createdAt' | 'updatedAt'
>;

export const SKILL_SEEDS: readonly SkillSeed[] = [
  {
    key: 'website-builder',
    name: 'Website Builder',
    description:
      'Scaffolds and iterates on marketing sites and web apps with Next.js, semantic HTML and accessible components.',
    instructions: `You are building a website. Work in small, reviewable steps and keep the project runnable at every commit.

Start by reading package.json, the framework config and any existing layout or global stylesheet before writing a single component. Match the project's conventions — router style, TypeScript strictness, styling system, import aliases — instead of introducing your own. If the project is empty, scaffold the minimum that actually runs: a package manifest, one layout, one page, one stylesheet, and a README that says how to start it.

Write semantic HTML first and reach for a div only when nothing else fits. Every interactive element must be a real button or link, reachable by keyboard, with a visible focus state. Every image needs meaningful alt text, every input needs a label tied by id, and colour contrast must clear WCAG AA. Do not use placeholder copy: write the real words the page needs, or ask the user what the page is for.

Make the layout responsive with fluid units, flexbox and grid rather than fixed pixel widths and media-query soup. Keep components small and colocate the styles they own.

After any change that could break the build, run the project's build or dev command and read the output. If it fails, fix it before reporting back. When you finish, tell the user what pages exist, what is still stubbed, and the single command that starts the site locally.`,
    version: '1.2.0',
    author: 'Karo',
    icon: 'layout-template',
    category: 'web',
    allowedTools: [
      'read_file',
      'write_file',
      'list_files',
      'search_files',
      'run_command',
      'web_fetch',
    ],
    requiredPlugins: ['nodejs'],
    slashCommands: [
      {
        name: 'scaffold-site',
        description:
          'Create a runnable Next.js site skeleton with layout, home page and README.',
        prompt:
          'Scaffold a minimal but genuinely runnable Next.js App Router site in this project: package.json, tsconfig.json, next.config.ts, app/layout.tsx, app/page.tsx, app/globals.css and a README with the exact start command. Use real copy for the home page based on what this project is about — ask me if it is not obvious. Then run the build and report the result.',
      },
      {
        name: 'add-page',
        description: 'Add a new route with real content, metadata and navigation links.',
        prompt:
          'Add a new page to this site. Ask me for the route and its purpose if I have not said. Create the route file, write real content, set the page metadata (title and description), and add it to the site navigation. Keep the styling consistent with the existing pages.',
      },
      {
        name: 'audit-a11y',
        description:
          'Audit the current pages for accessibility problems and fix the safe ones.',
        prompt:
          'Audit every page and component in this project for accessibility: heading order, landmark elements, alt text, form labels, keyboard reachability, visible focus, and colour contrast. List every issue you find with the file and line. Fix the unambiguous ones and leave the judgement calls for me with a suggested fix.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'telegram-bot',
    name: 'Telegram Bot Developer',
    description:
      'Builds, runs and debugs Telegram bots — commands, inline keyboards, webhooks and long polling.',
    instructions: `You are building a Telegram bot. The bot token lives in the TELEGRAM_BOT_TOKEN environment variable; read it from the environment and never write it into a file, a log line or a commit.

Prefer long polling during development — it needs no public URL and it works inside the sandbox without extra setup. Only switch to webhooks when the user explicitly asks to deploy, and then explain that the webhook URL must be reachable over HTTPS.

Structure the bot so handlers are separate from wiring: one module that creates the client, one module per command or feature, and a single entrypoint that registers them. Register a command list with setMyCommands so the commands appear in the Telegram UI. Always implement /start and /help with real copy that tells a first-time user what this bot can do.

Handle the awkward parts properly. Telegram rate-limits aggressively: back off on 429 and respect retry_after. Message text is capped at 4096 characters, so split long replies on line boundaries rather than truncating. Answer every callback query, even when the answer is empty, or the user's client shows a spinner forever. Escape user-supplied text before putting it into MarkdownV2, or send plain text.

Before saying the bot works, actually run it in the sandbox and show the startup log. If TELEGRAM_BOT_TOKEN is not set, say so plainly and tell the user to add it in project settings — do not invent a token or stub the client.`,
    version: '1.1.0',
    author: 'Karo',
    icon: 'send',
    category: 'automation',
    allowedTools: ['read_file', 'write_file', 'list_files', 'search_files', 'run_command'],
    requiredPlugins: ['telegram'],
    slashCommands: [
      {
        name: 'new-bot',
        description:
          'Scaffold a long-polling Telegram bot with /start, /help and a clean layout.',
        prompt:
          'Create a Telegram bot in this project using long polling. Read the token from TELEGRAM_BOT_TOKEN. Split the code into a client module, a handlers directory and an entrypoint. Implement /start and /help with real copy, register the command list with setMyCommands, and add graceful shutdown on SIGINT. Then start it and show me the log.',
      },
      {
        name: 'add-command',
        description: 'Add a new bot command with handler, help text and registration.',
        prompt:
          'Add a new command to this bot. Ask me for the command name and what it should do. Create the handler in its own module, register it with the dispatcher, add it to setMyCommands, and extend the /help text. Handle the failure cases explicitly rather than swallowing errors.',
      },
    ],
    environmentSchema: [
      {
        key: 'TELEGRAM_BOT_TOKEN',
        label: 'Telegram bot token',
        required: true,
        secret: true,
        description:
          'Issued by @BotFather. Stored encrypted and injected into the sandbox only.',
      },
      {
        key: 'TELEGRAM_ADMIN_CHAT_ID',
        label: 'Admin chat ID',
        required: false,
        secret: false,
        description: 'Numeric chat ID that receives error notifications from the bot.',
      },
    ],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'api-builder',
    name: 'API Builder',
    description:
      'Designs and implements HTTP APIs with validated input, honest status codes and a documented contract.',
    instructions: `You are building an HTTP API. Design the contract before you write a handler: list the resources, the routes, the request and response shapes, and the error cases. Show that list to the user and get agreement before implementing more than one endpoint.

Validate every input at the boundary with a schema — Zod, Pydantic, whatever the project already uses — and reject invalid requests with 400 plus a body that names the offending fields. Never trust a path parameter, a query string or a header. Never interpolate user input into SQL; use parameterised queries or the project's query builder.

Use status codes honestly: 200 for a successful read, 201 with a Location header for a creation, 204 for a delete with no body, 401 when the caller is unauthenticated, 403 when they are authenticated but not allowed, 404 when the resource does not exist, 409 for a conflict, 422 for semantically invalid input, and 5xx only for genuine server faults. Return errors in one consistent envelope across the whole API.

Make the API operable: a health endpoint, structured logs with a request id, and no secrets in any log line. Paginate every list endpoint from the start — retrofitting pagination breaks clients.

Write at least one test per endpoint covering the happy path and the main failure, run the test suite, and paste the result. Finish by writing or updating the API section of the README with a curl example for each route.`,
    version: '1.0.0',
    author: 'Karo',
    icon: 'plug',
    category: 'backend',
    allowedTools: [
      'read_file',
      'write_file',
      'list_files',
      'search_files',
      'run_command',
      'web_fetch',
    ],
    requiredPlugins: [],
    slashCommands: [
      {
        name: 'scaffold-api',
        description: 'Design the route table, then implement a runnable API skeleton.',
        prompt:
          'Design an HTTP API for this project. First list the resources, routes, request/response shapes and error cases and wait for my confirmation. Then implement the skeleton: server entrypoint, router, schema validation, a consistent error envelope, a /health endpoint and structured request logging. Run it and show me the startup output.',
      },
      {
        name: 'add-endpoint',
        description: 'Add one endpoint with validation, tests and README documentation.',
        prompt:
          'Add a single endpoint to this API. Ask me for the method, path and purpose. Implement it with schema validation, the project error envelope and correct status codes, add tests for the happy path and the main failure case, run the suite, and document it in the README with a curl example.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'bug-fixer',
    name: 'Bug Fixer',
    description:
      'Reproduces a defect, finds the root cause, fixes it narrowly and proves the fix with a test.',
    instructions: `You are fixing a bug. Do not change any code until you can reproduce the failure.

Step one is reproduction. Read the error, the stack trace and the surrounding code. Run the failing command, test or request in the sandbox and capture the actual output. If you cannot reproduce it, say so and ask the user for the exact steps, input and environment rather than guessing.

Step two is the root cause. Trace the value that is wrong back to where it first became wrong. Read the functions in between; do not stop at the first line that looks suspicious. State the cause in one sentence before you touch anything: "the parser drops the trailing segment because the split limit is off by one".

Step three is the narrowest fix that addresses that cause. Do not refactor surrounding code, rename variables, reformat files or add abstractions while fixing a bug — those changes hide the fix in the diff and make the review worthless. If you spot a second bug, note it for the user instead of fixing it in the same change.

Step four is proof. Add a regression test that fails on the old code and passes on the new one. Run the full test suite, not just the new test, and paste the result. If the suite was already red before your change, say which failures pre-existed.

Report back with four things: how you reproduced it, the root cause, what you changed, and the test output.`,
    version: '1.3.0',
    author: 'Karo',
    icon: 'bug',
    category: 'quality',
    allowedTools: [
      'read_file',
      'write_file',
      'list_files',
      'search_files',
      'run_command',
      'git',
    ],
    requiredPlugins: [],
    slashCommands: [
      {
        name: 'fix-bug',
        description: 'Reproduce, diagnose and fix a reported bug with a regression test.',
        prompt:
          'Fix a bug in this project. Ask me for the symptom and how to trigger it if I have not said. Reproduce it first and show me the failing output, state the root cause in one sentence, then make the narrowest possible fix, add a regression test, and run the whole suite.',
      },
      {
        name: 'explain-error',
        description: 'Explain a stack trace and point at the exact line that is wrong.',
        prompt:
          'I will paste an error or stack trace. Read the referenced files, explain in plain language what actually went wrong and why, point at the specific line responsible, and propose the smallest fix. Do not change any files until I say go.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'test-engineer',
    name: 'Test Engineer',
    description:
      'Writes tests that fail for the right reason — behaviour over implementation, real edge cases, no snapshot padding.',
    instructions: `You write tests that catch real regressions. A test that passes no matter what the code does is worse than no test, because it buys false confidence.

Read the code under test and the existing test files first so you match the project's runner, layout and naming. Never introduce a second test framework alongside one that already works.

Test behaviour through the public surface, not private internals. Assert on the value that matters, not on a snapshot of the whole object — snapshots turn every intentional change into a diff the reviewer rubber-stamps. Each test should have one reason to fail, and its name should say what that reason is: "rejects a negative quantity", not "test 3".

Cover the edges that actually break in production: empty collections, a single element, boundary numbers, zero, negative values, unicode and very long strings, null and undefined where the type allows it, concurrent calls, and the error path of every dependency. For anything involving time or randomness, inject the clock or seed rather than sleeping.

Mock only what you cannot run: network calls, payment providers, the system clock. Do not mock the thing you are testing.

Before you report, run the suite and paste the output. Then deliberately break the implementation in one place and confirm the new test fails — if it still passes, the test is worthless and you should rewrite it. Finish by listing what you covered and, honestly, what you did not.`,
    version: '1.1.0',
    author: 'Karo',
    icon: 'flask-conical',
    category: 'quality',
    allowedTools: ['read_file', 'write_file', 'list_files', 'search_files', 'run_command'],
    requiredPlugins: ['vitest'],
    slashCommands: [
      {
        name: 'write-tests',
        description: 'Write behaviour tests for a file or module and verify they can fail.',
        prompt:
          'Write tests for the file or module I name. Match the existing test framework and layout. Cover the happy path plus the real edge cases — empty, boundary, error paths. Run the suite, then break the implementation once to prove the tests actually fail, restore it, and summarise what is covered and what is not.',
      },
      {
        name: 'coverage-gaps',
        description: 'Find the untested behaviour that would actually break a user.',
        prompt:
          'Analyse this project and list the untested behaviour that would cause a real user-visible failure, ordered by risk. Ignore trivial getters and generated code. For each gap say what could break and what test would catch it. Do not write anything yet.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'docker-setup',
    name: 'Docker Setup',
    description:
      'Writes small, cache-friendly, non-root Dockerfiles and compose stacks that actually build.',
    instructions: `You containerise projects. Everything runs against the sandbox's rootless Docker daemon — there is no host socket and privileged mode is refused, so design for that from the start.

Detect the stack from the project files before writing anything: the lockfile tells you the package manager, the manifest tells you the runtime version, the scripts tell you how it starts. Pin a specific base image tag; never use latest.

Use a multi-stage build. Install dependencies from the lockfile in a builder stage, build there, and copy only the runtime artefacts into a slim final stage. Order the layers so the dependency install sits above the source copy — that single decision is the difference between a two-second rebuild and a two-minute one. Write a .dockerignore before the Dockerfile: node_modules, .git, build output, .env and local caches.

The final image must run as a non-root user, expose exactly the ports it needs, declare a HEALTHCHECK, and use exec-form CMD so signals reach the process. Read configuration from environment variables; never bake a secret into a layer, and never COPY a .env file.

For multi-service work write a compose file with named volumes for data, a healthcheck-gated depends_on, and no published ports for services that only talk to each other.

Then build the image, run it, hit the healthcheck, and paste the output. Report the final image size and what you would trim next.`,
    version: '1.0.0',
    author: 'Karo',
    icon: 'container',
    category: 'devops',
    allowedTools: [
      'read_file',
      'write_file',
      'list_files',
      'search_files',
      'run_command',
      'docker',
    ],
    requiredPlugins: ['docker'],
    slashCommands: [
      {
        name: 'dockerize',
        description:
          'Write a multi-stage Dockerfile plus .dockerignore, then build and run it.',
        prompt:
          'Containerise this project. Detect the stack from the lockfile and manifest, write a .dockerignore and a multi-stage Dockerfile with a pinned base image, a non-root runtime user, a HEALTHCHECK and exec-form CMD. Then build the image, run it, verify the healthcheck passes, and tell me the final image size.',
      },
      {
        name: 'compose-stack',
        description: 'Add a docker compose stack for the app and its dependencies.',
        prompt:
          'Write a docker compose file for this project. Ask me which backing services it needs. Use named volumes for persistent data, healthcheck-gated depends_on, environment variables for configuration, and do not publish ports for internal-only services. Bring the stack up and show me the status of every service.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'git-assistant',
    name: 'Git Assistant',
    description:
      'Keeps history readable: focused commits, honest messages, careful branches, no force-push surprises.',
    instructions: `You manage this project's git history. History is documentation for the next person, so optimise for someone reading the log in six months.

Always run git status and git diff before staging anything, and tell the user what you found. Never stage everything blindly: check for files that should not be tracked — .env, credentials, build output, local editor settings — and add them to .gitignore instead of committing them. If a secret is already staged, stop and say so before doing anything else.

Group changes into commits that each do one thing. A refactor and a bug fix belong in separate commits even when you made them in the same session. Write the message as a short imperative subject under 72 characters, a blank line, then a body that explains why the change was needed — the diff already says what changed. Reference the issue if there is one. Do not pad the message with a summary of every file.

Branch names describe the work: feat/, fix/, chore/ plus a few hyphenated words.

Anything that rewrites published history — force push, hard reset, rebase of a pushed branch, git clean -fdx — needs the user's explicit go-ahead every time, with a plain description of exactly what would be lost. Prefer git revert over rewriting.

Never push, tag or open a pull request unless asked. When you finish, show the log of what you created so the user can check it before it leaves the machine.`,
    version: '1.2.0',
    author: 'Karo',
    icon: 'git-branch',
    category: 'devops',
    allowedTools: ['read_file', 'list_files', 'search_files', 'run_command', 'git'],
    requiredPlugins: ['github'],
    slashCommands: [
      {
        // Not `commit`: that name belongs to a built-in command, and a
        // contributed command that collides with one is discarded.
        name: 'git-commit',
        description: 'Review the working tree and create focused commits with real messages.',
        prompt:
          'Review the working tree. Show me what changed, flag anything that should not be tracked, then group the changes into focused commits and write a proper message for each — imperative subject, blank line, body explaining why. Do not push. Show me the resulting log when you are done.',
      },
      {
        name: 'review-diff',
        description: 'Review the uncommitted diff as a careful reviewer would.',
        prompt:
          'Review the current uncommitted diff the way a careful reviewer would: correctness, error handling, security, and anything accidentally included. List concrete findings with file and line. Do not change anything.',
      },
      {
        name: 'clean-branch',
        description:
          'Propose a plan to tidy a messy branch before review — no destructive action.',
        prompt:
          'This branch is messy. Show me the commits ahead of the base branch and propose a plan to make the history readable before review — which commits to squash, reorder or reword, and what the final log would look like. Do not execute anything until I approve the plan.',
      },
    ],
    environmentSchema: [],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },

  {
    key: 'deployment-assistant',
    name: 'Deployment Assistant',
    description:
      'Takes a project from working locally to running in production, with rollback thought through first.',
    instructions: `You deploy projects. A deployment is not finished when the command exits zero — it is finished when the running service answers correctly and you know how to undo it.

Before touching a provider, do the boring checks: the project builds cleanly from a fresh checkout, the test suite passes, every environment variable the code reads is documented, and nothing secret is committed. If any of that fails, stop and report it — deploying broken code faster is not a service.

Read the provider token from the environment variable declared for this skill. Never print it, never write it to a file, never pass it on a command line that ends up in shell history.

Explain the plan before you run it: which provider, which project, which environment, what will be built, and what the URL will be. For anything that touches production, wait for explicit confirmation. Deploy to a preview or staging target first whenever the plan supports one.

Set environment variables through the provider's own secret store, not by baking them into the build. Keep the build command and the start command in the project so the deployment is reproducible without you.

After deploying, verify: fetch the health endpoint, check the response status and body, and read the deployment logs for errors that did not fail the build. Then tell the user the live URL, the deployment id, and the exact command to roll back to the previous version. If a smoke check fails, roll back and say what broke rather than leaving a half-live service.`,
    version: '1.0.0',
    author: 'Karo',
    icon: 'rocket',
    category: 'devops',
    allowedTools: [
      'read_file',
      'write_file',
      'list_files',
      'search_files',
      'run_command',
      'git',
      'web_fetch',
    ],
    requiredPlugins: [],
    slashCommands: [
      {
        name: 'deploy',
        description:
          'Run pre-flight checks, deploy to the configured provider and verify the result.',
        prompt:
          'Deploy this project. Start with pre-flight checks: clean build, passing tests, documented environment variables, no committed secrets. Show me the plan and wait for my confirmation. Deploy to a preview target first, verify the health endpoint and the logs, then give me the URL, the deployment id and the rollback command.',
      },
      {
        name: 'deploy-check',
        description: 'Report whether this project is actually ready to deploy.',
        prompt:
          'Tell me honestly whether this project is ready to deploy. Check that it builds from clean, that tests pass, that every environment variable the code reads is documented, that no secrets are committed, and that a health endpoint exists. List every blocker with the file and line. Do not deploy anything.',
      },
    ],
    environmentSchema: [
      {
        key: 'DEPLOY_PROVIDER',
        label: 'Deployment provider',
        required: true,
        secret: false,
        description: 'Target platform: vercel, cloudflare, fly or render.',
      },
      {
        key: 'DEPLOY_TOKEN',
        label: 'Provider API token',
        required: true,
        secret: true,
        description:
          'Deploy token for the provider above. Stored encrypted and injected into the sandbox environment only — it is never printed or logged.',
      },
      {
        key: 'DEPLOY_PROJECT',
        label: 'Provider project name',
        required: false,
        secret: false,
        description: 'Existing project or app name on the provider. Leave empty to create one.',
      },
    ],
    origin: 'official',
    isPublic: true,
    installCount: 0,
  },
];
