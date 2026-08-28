/**
 * Project starter templates.
 *
 * Stored in `admin_settings` under `project.templates` — there is no dedicated
 * table, and keeping them as data lets an operator add a template without a
 * migration or a deploy.
 *
 * Every scaffold here has to *actually run*. A template that produces a project
 * failing on its first command is worse than an empty one, because the user
 * spends their first five minutes debugging Karo instead of their idea. Keep
 * them small (4–8 files) and correct rather than large and impressive.
 */
export type TemplateFile = {
  path: string;
  content: string;
};

export type ProjectTemplateSeed = {
  key: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  /** Language shown on the template card. */
  language: string;
  files: TemplateFile[];
  /** Run in order in the sandbox after the files land. */
  setupCommands: string[];
  /** Command the preview pane runs, if the template serves anything. */
  devCommand: string | null;
  /** Port the preview proxy listens on. */
  devPort: number | null;
  sortOrder: number;
};

const MIT_GITIGNORE = `node_modules/
dist/
build/
.next/
coverage/
*.log
.env
.env.local
.DS_Store
`;

export const PROJECT_TEMPLATE_SEEDS: readonly ProjectTemplateSeed[] = [
  /* ------------------------------------------------------------------ */
  {
    key: 'blank',
    name: 'Blank project',
    description:
      'An empty workspace with a README and sensible ignore rules. Start from nothing and tell the agent what to build.',
    icon: 'file',
    tags: ['empty', 'any-language'],
    language: 'None',
    files: [
      {
        path: 'README.md',
        content: `# New project

This workspace is empty on purpose.

Describe what you want in the chat panel and the agent will scaffold it. Useful
opening moves:

- "Set up a Rust CLI that reads a CSV and prints summary statistics."
- "Create a FastAPI service with one endpoint and a test for it."
- "Look at the files I upload and tell me what this project does."

## The machine

Your project lives in \`/workspace\` on a real Linux sandbox. The agent can read
and write files here, run shell commands, and start long-running processes. The
sandbox sleeps after a period of inactivity and wakes on your next command —
files persist across sleeps.
`,
      },
      { path: '.gitignore', content: MIT_GITIGNORE },
      {
        path: '.editorconfig',
        content: `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.py]
indent_size = 4
`,
      },
    ],
    setupCommands: ['git init -q'],
    devCommand: null,
    devPort: null,
    sortOrder: 10,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'nextjs-website',
    name: 'Next.js website',
    description:
      'Next.js 16 App Router with TypeScript and a real landing page. Builds and serves on the first command.',
    icon: 'layout-template',
    tags: ['nextjs', 'react', 'typescript', 'web'],
    language: 'TypeScript',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "nextjs-website",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "16.2.12",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/node": "26.1.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "typescript": "5.9.3"
  }
}
`,
      },
      {
        path: 'next.config.ts',
        content: `import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The preview proxy terminates TLS in front of the sandbox.
  poweredByHeader: false,
};

export default config;
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
      },
      {
        path: 'app/layout.tsx',
        content: `import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'New site',
  description: 'A Next.js site scaffolded in Karo. Replace this description with your own.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: 'app/page.tsx',
        content: `export default function HomePage() {
  return (
    <main className="page">
      <h1>Your site is running</h1>
      <p>
        This page is served by Next.js from the sandbox attached to this project. Edit{' '}
        <code>app/page.tsx</code> and the preview reloads.
      </p>
      <ul className="next-steps">
        <li>Ask the agent to add a route, and it will wire it into the navigation.</li>
        <li>Ask for a component and it will match the conventions already in this file.</li>
        <li>
          Run <code>npm run build</code> in the terminal to check a production build before you
          deploy.
        </li>
      </ul>
    </main>
  );
}
`,
      },
      {
        path: 'app/globals.css',
        content: `:root {
  color-scheme: light dark;
  --page-fg: #16170f;
  --page-bg: #fbfbf7;
  --page-accent: #1f7a52;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page-fg: #edeee6;
    --page-bg: #14150f;
    --page-accent: #4ec48c;
  }
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--page-bg);
  color: var(--page-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
}

.page {
  max-width: 40rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
}

h1 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  letter-spacing: -0.02em;
  margin: 0 0 1rem;
}

code {
  font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace;
  font-size: 0.9em;
  background: color-mix(in oklab, var(--page-fg) 8%, transparent);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}

.next-steps {
  margin-top: 2rem;
  padding-left: 1.25rem;
}

.next-steps li + li {
  margin-top: 0.5rem;
}

a {
  color: var(--page-accent);
}

:focus-visible {
  outline: 2px solid var(--page-accent);
  outline-offset: 2px;
}
`,
      },
      {
        path: 'README.md',
        content: `# Next.js website

Next.js 16 App Router, React 19, TypeScript in strict mode.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

The preview pane proxies port 3000. \`npm run build\` produces a production build
and \`npm run typecheck\` runs TypeScript without emitting.

## Layout

| Path | Purpose |
| --- | --- |
| \`app/layout.tsx\` | Root layout, \`<html>\` shell and page metadata |
| \`app/page.tsx\` | Home route at \`/\` |
| \`app/globals.css\` | Global styles and the colour tokens |
| \`next.config.ts\` | Framework configuration |

Add a route by creating \`app/<segment>/page.tsx\`. Async pages receive \`params\`
and \`searchParams\` as promises in Next 16 — \`await\` them before use.
`,
      },
    ],
    setupCommands: ['npm install'],
    devCommand: 'npm run dev',
    devPort: 3000,
    sortOrder: 20,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'telegram-bot',
    name: 'Telegram bot',
    description:
      'A long-polling Telegram bot with /start and /help, graceful shutdown and no webhook to configure.',
    icon: 'send',
    tags: ['telegram', 'bot', 'node', 'automation'],
    language: 'JavaScript',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "telegram-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "node-telegram-bot-api": "0.66.0"
  }
}
`,
      },
      {
        path: 'src/index.js',
        content: `import TelegramBot from 'node-telegram-bot-api';
import { COMMANDS, registerHandlers } from './commands.js';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(
    'TELEGRAM_BOT_TOKEN is not set.\\n' +
      'Add it under Project settings -> Environment, then restart this process.',
  );
  process.exit(1);
}

// Long polling: no public URL required, which is what you want while developing.
const bot = new TelegramBot(token, { polling: true });

registerHandlers(bot);

bot.setMyCommands(COMMANDS).catch((error) => {
  console.warn('Could not publish the command list:', error.message);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

const shutdown = async (signal) => {
  console.log('Received ' + signal + ', stopping the bot.');
  await bot.stopPolling({ cancel: true }).catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

bot
  .getMe()
  .then((me) => console.log('Bot @' + me.username + ' is listening.'))
  .catch((error) => {
    console.error('Telegram rejected the token:', error.message);
    process.exit(1);
  });
`,
      },
      {
        path: 'src/commands.js',
        content: `/** Published to Telegram so the commands appear in the client UI. */
export const COMMANDS = [
  { command: 'start', description: 'What this bot does' },
  { command: 'help', description: 'List the available commands' },
  { command: 'ping', description: 'Check that the bot is alive' },
];

/** Telegram rejects messages longer than 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096;

function send(bot, chatId, text) {
  const chunks = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE_LENGTH) {
    const cut = rest.lastIndexOf('\\n', MAX_MESSAGE_LENGTH);
    const at = cut > 0 ? cut : MAX_MESSAGE_LENGTH;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  chunks.push(rest);
  return chunks.reduce(
    (chain, chunk) => chain.then(() => bot.sendMessage(chatId, chunk)),
    Promise.resolve(),
  );
}

export function registerHandlers(bot) {
  bot.onText(/^\\/start\\b/, (msg) => {
    const name = msg.from?.first_name ?? 'there';
    send(
      bot,
      msg.chat.id,
      'Hi ' + name + '. This bot was scaffolded in Karo and does not do much yet.\\n\\n' +
        'Send /help to see what it can do, or tell the agent what you want it to become.',
    );
  });

  bot.onText(/^\\/help\\b/, (msg) => {
    const lines = COMMANDS.map((c) => '/' + c.command + ' — ' + c.description);
    send(bot, msg.chat.id, 'Commands:\\n' + lines.join('\\n'));
  });

  bot.onText(/^\\/ping\\b/, (msg) => {
    send(bot, msg.chat.id, 'pong');
  });

  // Anything that is not a known command.
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    send(bot, msg.chat.id, 'I received: ' + msg.text);
  });
}
`,
      },
      {
        path: '.env.example',
        content: `# Copy to .env and fill in. .env is git-ignored.
# Issued by @BotFather in Telegram.
TELEGRAM_BOT_TOKEN=

# Optional: numeric chat id that receives error notifications.
TELEGRAM_ADMIN_CHAT_ID=
`,
      },
      { path: '.gitignore', content: MIT_GITIGNORE },
      {
        path: 'README.md',
        content: `# Telegram bot

Long-polling Telegram bot. No public URL, no webhook, no tunnel.

## Set it up

1. Message [@BotFather](https://t.me/BotFather) and run \`/newbot\`.
2. Copy the token it gives you.
3. Add \`TELEGRAM_BOT_TOKEN\` under **Project settings → Environment** (it is
   stored encrypted and injected into the sandbox only).
4. Run it:

\`\`\`bash
npm install
npm start
\`\`\`

Open Telegram, find your bot and send \`/start\`.

## Layout

| Path | Purpose |
| --- | --- |
| \`src/index.js\` | Client setup, command publication, graceful shutdown |
| \`src/commands.js\` | Command list and handlers |

## Notes

- Replies longer than 4096 characters are split on line boundaries.
- Telegram rate-limits aggressively; back off and honour \`retry_after\` on 429.
- Switch to webhooks only when you deploy — they need a public HTTPS endpoint.
`,
      },
    ],
    setupCommands: ['npm install'],
    devCommand: 'npm start',
    devPort: null,
    sortOrder: 30,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'python-api',
    name: 'Python API',
    description:
      'FastAPI service with validated request models, a health endpoint and a passing test suite.',
    icon: 'file-code',
    tags: ['python', 'fastapi', 'api', 'backend'],
    language: 'Python',
    files: [
      {
        path: 'requirements.txt',
        content: `fastapi==0.115.11
uvicorn[standard]==0.34.0
pydantic==2.10.6
pytest==8.3.5
httpx==0.28.1
`,
      },
      {
        path: 'main.py',
        content: `"""A small FastAPI service. Run with: uvicorn main:app --reload --port 8000"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

app = FastAPI(
    title="Python API",
    description="Scaffolded in Karo. Replace this description with your own.",
    version="0.1.0",
)

STARTED_AT = datetime.now(timezone.utc)


class Health(BaseModel):
    status: str
    uptime_seconds: float
    environment: str


class EchoRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    shout: bool = False


class EchoResponse(BaseModel):
    message: str
    length: int


@app.get("/health", response_model=Health, tags=["ops"])
def health() -> Health:
    """Liveness probe. Cheap on purpose — no database, no downstream calls."""
    return Health(
        status="ok",
        uptime_seconds=(datetime.now(timezone.utc) - STARTED_AT).total_seconds(),
        environment=os.environ.get("APP_ENV", "development"),
    )


@app.post("/echo", response_model=EchoResponse, status_code=200, tags=["demo"])
def echo(payload: EchoRequest) -> EchoResponse:
    """Validates its input and returns it. Delete this once you have real routes."""
    text = payload.message.upper() if payload.shout else payload.message
    return EchoResponse(message=text, length=len(text))


@app.get("/items/{item_id}", tags=["demo"])
def get_item(item_id: int, verbose: Annotated[bool, Query()] = False) -> dict[str, object]:
    if item_id < 1:
        raise HTTPException(status_code=422, detail="item_id must be a positive integer")
    if item_id > 100:
        raise HTTPException(status_code=404, detail="No item with that id")
    body: dict[str, object] = {"id": item_id, "name": f"Item {item_id}"}
    if verbose:
        body["retrieved_at"] = datetime.now(timezone.utc).isoformat()
    return body
`,
      },
      {
        path: 'test_main.py',
        content: `from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_reports_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_echo_returns_the_message() -> None:
    response = client.post("/echo", json={"message": "hello"})
    assert response.status_code == 200
    assert response.json() == {"message": "hello", "length": 5}


def test_echo_rejects_an_empty_message() -> None:
    response = client.post("/echo", json={"message": ""})
    assert response.status_code == 422


def test_unknown_item_is_a_404() -> None:
    assert client.get("/items/101").status_code == 404


def test_zero_item_id_is_unprocessable() -> None:
    assert client.get("/items/0").status_code == 422
`,
      },
      {
        path: '.env.example',
        content: `# Copy to .env and fill in. .env is git-ignored.
APP_ENV=development
PORT=8000

# Example: postgresql://user:password@localhost:5432/app
DATABASE_URL=
`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
.env
.DS_Store
`,
      },
      {
        path: 'README.md',
        content: `# Python API

FastAPI + Pydantic v2, with a test suite that actually passes.

## Run it

\`\`\`bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
\`\`\`

The preview pane proxies port 8000. Interactive docs are at \`/docs\`.

## Test it

\`\`\`bash
pytest -q
\`\`\`

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | \`/health\` | Liveness probe with uptime |
| POST | \`/echo\` | Validated echo — delete once you have real routes |
| GET | \`/items/{item_id}\` | Demonstrates path params and honest status codes |

Every request body is a Pydantic model, so invalid input returns 422 with the
offending field named rather than a 500.
`,
      },
    ],
    setupCommands: [
      'python -m venv .venv',
      '.venv/bin/pip install --disable-pip-version-check -r requirements.txt',
    ],
    devCommand: '.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload',
    devPort: 8000,
    sortOrder: 40,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'node-api',
    name: 'Node.js API',
    description:
      'Express 5 API with a consistent error envelope, request ids, health endpoint and graceful shutdown.',
    icon: 'plug',
    tags: ['node', 'express', 'api', 'backend'],
    language: 'JavaScript',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "node-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "5.1.0"
  }
}
`,
      },
      {
        path: 'src/server.js',
        content: `import { randomUUID } from 'node:crypto';
import express from 'express';
import { registerRoutes } from './routes.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// One id per request, echoed back and attached to every log line for that request.
app.use((req, res, next) => {
  req.id = req.get('x-request-id') ?? randomUUID();
  res.set('x-request-id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        id: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - started,
      }),
    );
  });
  next();
});

registerRoutes(app);

// Unknown route -> the same error envelope as everything else.
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: 'No route matches ' + req.method + ' ' + req.path },
    requestId: req.id,
  });
});

// Final error handler. Never leak a stack trace to the client.
app.use((error, req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(JSON.stringify({ id: req.id, error: error.stack }));
  res.status(status).json({
    error: {
      code: error.code ?? (status >= 500 ? 'internal_error' : 'bad_request'),
      message: status >= 500 ? 'Something went wrong on our side.' : error.message,
    },
    requestId: req.id,
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log('Listening on http://0.0.0.0:' + port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('Received ' + signal + ', draining connections.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

export { app };
`,
      },
      {
        path: 'src/routes.js',
        content: `const startedAt = Date.now();

/** Tiny validator so the template needs no dependency to reject bad input. */
function requireString(value, field, { max = 2000 } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(field + ' is required and must be a non-empty string');
    error.status = 422;
    error.code = 'invalid_input';
    throw error;
  }
  if (value.length > max) {
    const error = new Error(field + ' must be at most ' + max + ' characters');
    error.status = 422;
    error.code = 'invalid_input';
    throw error;
  }
  return value;
}

export function registerRoutes(app) {
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      environment: process.env.NODE_ENV ?? 'development',
    });
  });

  app.post('/echo', (req, res, next) => {
    try {
      const message = requireString(req.body?.message, 'message');
      res.json({ message, length: message.length });
    } catch (error) {
      next(error);
    }
  });

  // Cursor pagination from the start — retrofitting it breaks clients.
  app.get('/items', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const cursor = Number(req.query.cursor) || 0;
    const items = Array.from({ length: limit }, (_, i) => ({
      id: cursor + i + 1,
      name: 'Item ' + (cursor + i + 1),
    }));
    res.json({ items, nextCursor: cursor + limit });
  });
}
`,
      },
      { path: '.gitignore', content: MIT_GITIGNORE },
      {
        path: 'README.md',
        content: `# Node.js API

Express 5 on Node 20+, ES modules, zero build step.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

The preview pane proxies port 3000. \`npm start\` runs it without the watcher.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | \`/health\` | Liveness probe with uptime |
| POST | \`/echo\` | Validated echo; 422 when \`message\` is missing |
| GET | \`/items\` | Cursor-paginated list (\`?limit=\`, \`?cursor=\`) |

## Conventions

- Every response carries an \`x-request-id\` header; the same id appears in the
  JSON log line for that request and in the error body.
- Errors always look like
  \`{ "error": { "code": "...", "message": "..." }, "requestId": "..." }\`.
- 5xx responses never include the stack trace — it goes to the log instead.
- SIGTERM drains in-flight connections before exit, with a 10 second hard cap.
`,
      },
    ],
    setupCommands: ['npm install'],
    devCommand: 'npm run dev',
    devPort: 3000,
    sortOrder: 50,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'static-website',
    name: 'Static website',
    description:
      'One HTML page, one stylesheet, one script. No build step, no dependencies, serves instantly.',
    icon: 'globe',
    tags: ['html', 'css', 'static', 'web'],
    language: 'HTML',
    files: [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Static site</title>
    <meta
      name="description"
      content="A static site scaffolded in Karo. Replace this description with your own."
    />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">Static site</a>
      <nav aria-label="Primary">
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <h1>No build step, no dependencies</h1>
        <p>
          Three files served straight from the sandbox. Edit them and reload the preview —
          there is nothing to compile.
        </p>
        <button type="button" id="counter" class="button">Clicked 0 times</button>
      </section>

      <section id="about">
        <h2>About</h2>
        <p>
          Replace this text with what the site is actually for. Ask the agent for another
          section and it will match the markup and styles already here.
        </p>
      </section>

      <section id="contact">
        <h2>Contact</h2>
        <p>Add your real contact details here.</p>
      </section>
    </main>

    <footer class="site-footer">
      <p>Built with Karo.</p>
    </footer>

    <script src="main.js" type="module"></script>
  </body>
</html>
`,
      },
      {
        path: 'styles.css',
        content: `:root {
  color-scheme: light dark;
  --fg: #16170f;
  --bg: #fbfbf7;
  --muted: #5e6154;
  --accent: #1f7a52;
  --line: #e2e2d8;
}

@media (prefers-color-scheme: dark) {
  :root {
    --fg: #edeee6;
    --bg: #14150f;
    --muted: #9b9e90;
    --accent: #4ec48c;
    --line: #2a2c22;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--line);
}

.brand {
  font-weight: 600;
  text-decoration: none;
  color: inherit;
}

nav a {
  color: var(--muted);
  text-decoration: none;
  margin-left: 1rem;
}

nav a:hover,
nav a:focus-visible {
  color: var(--accent);
}

main {
  max-width: 44rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}

.hero h1 {
  font-size: clamp(1.75rem, 5vw, 2.75rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.75rem;
}

section + section {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--line);
}

.button {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--bg);
  border-radius: 8px;
  padding: 0.55rem 1rem;
}

.button:hover {
  filter: brightness(1.08);
}

.site-footer {
  border-top: 1px solid var(--line);
  color: var(--muted);
  padding: 1.5rem;
  text-align: center;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
`,
      },
      {
        path: 'main.js',
        content: `const counter = document.getElementById('counter');

if (counter) {
  let clicks = 0;
  counter.addEventListener('click', () => {
    clicks += 1;
    counter.textContent = 'Clicked ' + clicks + (clicks === 1 ? ' time' : ' times');
  });
}

// Smooth in-page navigation that still respects a reduced-motion preference.
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

for (const link of document.querySelectorAll('nav a[href^="#"]')) {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}
`,
      },
      {
        path: 'README.md',
        content: `# Static website

Three files. No framework, no bundler, no install.

## Run it

\`\`\`bash
python3 -m http.server 8000
\`\`\`

The preview pane proxies port 8000. Any static server works — this one is just
already installed in the sandbox.

## Layout

| Path | Purpose |
| --- | --- |
| \`index.html\` | Markup and content |
| \`styles.css\` | Colour tokens, layout, light and dark themes |
| \`main.js\` | The small amount of behaviour the page needs |

The stylesheet uses \`color-scheme\` plus a \`prefers-color-scheme\` block, so the
page follows the visitor's system theme without any JavaScript.
`,
      },
    ],
    setupCommands: [],
    devCommand: 'python3 -m http.server 8000',
    devPort: 8000,
    sortOrder: 60,
  },

  /* ------------------------------------------------------------------ */
  {
    key: 'automation-worker',
    name: 'Automation worker',
    description:
      'A scheduled worker loop with retry, backoff and structured logging. Add a job file and it runs.',
    icon: 'clock',
    tags: ['node', 'automation', 'cron', 'worker'],
    language: 'JavaScript',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "automation-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/worker.js",
    "once": "node src/worker.js --once"
  },
  "dependencies": {}
}
`,
      },
      {
        path: 'src/worker.js',
        content: `import { jobs } from './jobs/index.js';

const runOnce = process.argv.includes('--once');
const intervalMs = Number(process.env.INTERVAL_MS ?? 60_000);
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? 3);

function log(level, event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), level, event, ...fields }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries with exponential backoff and full jitter, so retries do not synchronise. */
async function runWithRetry(job) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const result = await job.run();
      log('info', 'job.succeeded', { job: job.name, attempt, ms: Date.now() - started, result });
      return true;
    } catch (error) {
      const last = attempt === maxAttempts;
      log(last ? 'error' : 'warn', 'job.failed', {
        job: job.name,
        attempt,
        ms: Date.now() - started,
        message: error.message,
      });
      if (last) return false;
      const backoff = Math.min(30_000, 2 ** attempt * 500);
      await sleep(Math.random() * backoff);
    }
  }
  return false;
}

async function tick() {
  log('info', 'tick.start', { jobs: jobs.length });
  const results = await Promise.all(jobs.map(runWithRetry));
  log('info', 'tick.end', {
    succeeded: results.filter(Boolean).length,
    failed: results.filter((ok) => !ok).length,
  });
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('info', 'shutdown.requested', { signal });
    stopping = true;
  });
}

log('info', 'worker.start', { intervalMs, maxAttempts, runOnce });

await tick();
if (!runOnce) {
  while (!stopping) {
    await sleep(intervalMs);
    if (stopping) break;
    await tick();
  }
}
log('info', 'worker.stopped');
`,
      },
      {
        path: 'src/jobs/index.js',
        content: `import { cleanupTempFiles } from './cleanup-temp-files.js';
import { checkEndpoint } from './check-endpoint.js';

/**
 * Every job is { name, run } where run() resolves with a small summary object
 * and rejects on failure. Add a file here and export it from this array.
 */
export const jobs = [cleanupTempFiles, checkEndpoint];
`,
      },
      {
        path: 'src/jobs/cleanup-temp-files.js',
        content: `import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIRECTORY = process.env.TEMP_DIR ?? '/workspace/tmp';
const MAX_AGE_MS = Number(process.env.TEMP_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);

export const cleanupTempFiles = {
  name: 'cleanup-temp-files',
  async run() {
    let entries;
    try {
      entries = await readdir(DIRECTORY);
    } catch (error) {
      if (error.code === 'ENOENT') return { removed: 0, skipped: 'directory does not exist' };
      throw error;
    }

    const cutoff = Date.now() - MAX_AGE_MS;
    let removed = 0;
    for (const entry of entries) {
      const path = join(DIRECTORY, entry);
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    }
    return { removed, scanned: entries.length };
  },
};
`,
      },
      {
        path: 'src/jobs/check-endpoint.js',
        content: `const URL_TO_CHECK = process.env.HEALTH_URL ?? '';
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 5000);

export const checkEndpoint = {
  name: 'check-endpoint',
  async run() {
    if (!URL_TO_CHECK) return { skipped: 'HEALTH_URL is not set' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const started = Date.now();
      const response = await fetch(URL_TO_CHECK, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(URL_TO_CHECK + ' returned ' + response.status);
      }
      return { url: URL_TO_CHECK, status: response.status, ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  },
};
`,
      },
      {
        path: '.env.example',
        content: `# Copy to .env and fill in. .env is git-ignored.
# Milliseconds between ticks.
INTERVAL_MS=60000
# Attempts per job before it is recorded as failed.
MAX_ATTEMPTS=3

# cleanup-temp-files
TEMP_DIR=/workspace/tmp
TEMP_MAX_AGE_MS=86400000

# check-endpoint — leave empty to skip this job.
HEALTH_URL=
HEALTH_TIMEOUT_MS=5000
`,
      },
      {
        path: 'README.md',
        content: `# Automation worker

A supervised loop that runs jobs on an interval, retries with jittered
exponential backoff, and logs one JSON object per event.

## Run it

\`\`\`bash
npm start        # loop forever
npm run once     # single tick, then exit — useful for testing a job
\`\`\`

## Add a job

Create \`src/jobs/<name>.js\` exporting \`{ name, run }\`:

\`\`\`js
export const myJob = {
  name: 'my-job',
  async run() {
    // Throw to signal failure; the worker retries and logs.
    return { processed: 12 };
  },
};
\`\`\`

Then add it to the array in \`src/jobs/index.js\`. Jobs in one tick run in
parallel, and one failing job never stops the others.

## Notes

- The sandbox sleeps when idle. A worker that must run continuously should be
  kept awake by the schedule, or moved to your own server via BYOS.
- Configuration comes from environment variables — see \`.env.example\`.
`,
      },
      { path: '.gitignore', content: MIT_GITIGNORE },
    ],
    setupCommands: ['mkdir -p tmp'],
    devCommand: 'npm start',
    devPort: null,
    sortOrder: 70,
  },
];

/** Convenience lookup used by the seed and by the project-create flow. */
export function findProjectTemplate(key: string): ProjectTemplateSeed | undefined {
  return PROJECT_TEMPLATE_SEEDS.find((template) => template.key === key);
}
