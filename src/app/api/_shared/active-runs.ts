import 'server-only';

/**
 * The registry of in-flight agent runs.
 *
 * `POST /conversations/[id]/messages` streams a run; `POST /conversations/[id]/stop`
 * has to cancel it from a *different* request. The only thing they can share is
 * process state, so the streaming route parks its `AbortController` here and the
 * stop route pulls it out again.
 *
 * The map hangs off `globalThis` rather than a module-level `const` for the same
 * reason the database pool does: Next.js bundles each route handler separately
 * and re-evaluates modules on hot reload, so two routes importing this file are
 * not otherwise guaranteed to see the same instance.
 *
 * Single-node by design. A multi-node deployment routes `/stop` to the node
 * holding the stream via a sticky hash on the conversation id; that belongs in
 * the ingress layer, not here.
 */

type RunEntry = {
  runId: string | null;
  controller: AbortController;
  startedAt: number;
};

const globalForRuns = globalThis as unknown as {
  __karoActiveRuns?: Map<string, RunEntry>;
};

function registry(): Map<string, RunEntry> {
  globalForRuns.__karoActiveRuns ??= new Map();
  return globalForRuns.__karoActiveRuns;
}

/**
 * Registers a run and returns its release function. Any run already streaming
 * in this conversation is aborted first — a second message supersedes the one
 * in flight rather than racing it.
 */
export function registerRun(conversationId: string, controller: AbortController): () => void {
  const existing = registry().get(conversationId);
  if (existing && existing.controller !== controller) {
    existing.controller.abort();
  }

  const entry: RunEntry = { runId: null, controller, startedAt: Date.now() };
  registry().set(conversationId, entry);

  return () => {
    // Only clear our own entry: a newer run may already own the slot.
    if (registry().get(conversationId) === entry) registry().delete(conversationId);
  };
}

/** Attaches the run id once `run.start` has been seen, for diagnostics. */
export function attachRunId(conversationId: string, runId: string): void {
  const entry = registry().get(conversationId);
  if (entry) entry.runId = runId;
}

/** Aborts the active run. Returns the run id when there was one to stop. */
export function abortRun(conversationId: string): { stopped: boolean; runId: string | null } {
  const entry = registry().get(conversationId);
  if (!entry) return { stopped: false, runId: null };

  entry.controller.abort();
  registry().delete(conversationId);
  return { stopped: true, runId: entry.runId };
}

export function isRunActive(conversationId: string): boolean {
  return registry().has(conversationId);
}
