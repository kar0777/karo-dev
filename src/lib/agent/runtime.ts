import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { resolveModel } from '@/lib/ai';
import type { ChatMessage, CompletionChunk, ToolDefinition } from '@/lib/ai/types';
import { ProviderError } from '@/lib/ai/types';
import { db } from '@/lib/db';
import {
  agentRuns,
  conversations,
  installedSkills,
  messages,
  projectFiles,
  projects,
  sandboxes,
  skills as skillsTable,
  toolCalls as toolCallsTable,
} from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { estimateTaskCost } from '@/lib/pricing/calculator';
import { getProvider } from '@/lib/sandbox';
import type { SandboxProvider } from '@/lib/sandbox/types';
import type {
  AgentErrorCode,
  AgentStreamEvent,
  PlanStepStatus,
  StreamUsage,
} from '@/lib/types/agent';
import {
  loadBillingContext,
  recordModelUsage,
  releaseRunBudget,
  reserveRunBudget,
} from '@/lib/usage/metering';
import { env } from '@/lib/env';
import { checkSpendGuard } from '@/lib/pricing/calculator';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { callTool, loadToolsForProject } from '@/lib/mcp/manager';
import { buildSystemPrompt } from './prompt';
import { resolveAgentPermissions, type AgentPermissions } from './policy';
import {
  BUILTIN_TOOL_DEFINITIONS,
  BUILTIN_TOOL_HANDLERS,
  sanitizeToolOutput,
  type ToolContext,
  type ToolResult,
} from './tools';

const log = createLogger('agent');

export type RunAgentInput = {
  conversationId: string;
  projectId: string;
  teamId: string;
  userId: string;
  /** The turn this run answers, echoed back when the run needs confirming. */
  userMessageId: string;
  mode: 'ask' | 'plan' | 'build' | 'auto';
  modelId?: string | null;
  signal?: AbortSignal;
  /** Caps the tool-use loop. Auto mode gets more room than Build. */
  maxIterations?: number;
  /**
   * Cost the caller has already shown the user and had accepted, micro-USD.
   * Only relevant when the estimate lands over `billing.expensive_task_warn_micro_usd`.
   */
  acknowledgedCostMicroUsd?: number;
};

const MAX_ITERATIONS: Record<RunAgentInput['mode'], number> = {
  ask: 1,
  plan: 6,
  build: 12,
  auto: 24,
};

/**
 * Ceiling on MCP tool definitions offered in one run. A server exposing
 * dozens of tools is a context-window hazard, not a feature; the server's
 * `allowedTools` list is the intended way to narrow a chatty server.
 */
const MAX_MCP_TOOLS = 40;

/**
 * The agent loop.
 *
 * One pass = ask the model → stream its text → run whatever tools it called →
 * feed the results back. Repeat until the model stops calling tools, the
 * iteration cap is hit, the user stops it, or something needs approval.
 *
 * Everything the UI needs arrives as `AgentStreamEvent`s; the same events are
 * persisted, so reloading a conversation reconstructs exactly what was shown.
 */
export async function* runAgent(input: RunAgentInput): AsyncGenerator<AgentStreamEvent> {
  const startedAt = Date.now();

  // The upstream model stream hangs off this controller, not directly off the
  // request signal: the stall watchdog (only) needs to cut a silent provider
  // connection without pretending the user cancelled the run.
  const upstreamAbort = new AbortController();
  input.signal?.addEventListener(
    'abort',
    () => upstreamAbort.abort(new Error('The run was stopped.')),
    { once: true },
  );

  // One function hosts the entire turn; past the platform duration cap it is
  // killed with no error ever reaching the browser. End the run deliberately
  // a little before that, so the user gets an honest "send again to retry"
  // instead of an eternally spinning cursor.
  const turnDeadline = startedAt + MAX_TURN_MS;

  const context = await loadRunContext(input);
  if ('error' in context) {
    yield errorEvent(context.error.code, context.error.message, context.error.retryable);
    return;
  }

  const {
    conversation,
    permissions,
    sandbox,
    sandboxProvider,
    model,
    history,
    systemPrompt,
    billing,
    modelNotice,
    mcp,
  } = context;

  // Said before anything streams, so the reply is never read as coming from the
  // model the conversation still names.
  if (modelNotice) {
    yield { type: 'notice', level: 'warning', message: modelNotice };
  }

  /* ---- Pre-flight spend guard ---------------------------------------- */

  // The pre-flight estimate is sized on the iteration ceiling the loop will
  // actually honour. It used to assume 6 iterations in `auto` mode while the loop
  // was allowed 24, so a run could be admitted on an estimate a quarter of what
  // it could spend and then blow straight through the spend cap and credit limit.
  //
  // `agent.maxIterations` is the operator's ceiling over all of it. It caps
  // rather than replaces the per-mode numbers, because an admin lowering the
  // limit means "no run may go this far", not "Ask mode may now take 24 steps".
  // Resolved once here so the estimate, the run row and the loop cannot disagree
  // about how far this run is allowed to go.
  const adminIterationCeiling = await getSetting<number>(
    SETTING_KEYS.agentMaxIterations,
    MAX_ITERATIONS.auto,
  );
  const iterationCeiling = Math.max(
    1,
    Math.min(input.maxIterations ?? MAX_ITERATIONS[input.mode], adminIterationCeiling),
  );

  const estimate = estimateTaskCost({
    promptTokens:
      estimateTokens(systemPrompt) + history.reduce((n, m) => n + estimateTokens(textOf(m)), 0),
    expectedIterations: iterationCeiling,
    expectedOutputTokensPerIteration: 700,
    contextGrowthPerIteration: 900,
    prices: model.prices,
    plan: billing.planPricing,
    quotaRemainingWeighted: billing.quotaRemainingWeighted,
    computeMultiplier: sandbox?.computeMultiplier ?? 1,
    expectedMinutes: input.mode === 'auto' ? 8 : 2,
    upstreamMicroUsdPerBaseHour: sandboxProvider?.upstreamMicroUsdPerBaseHour ?? 0,
  });

  // A run the operator considers expensive does not start until the person
  // paying for it has seen the figure and said yes. This sits ahead of admission
  // on purpose: a run that was refused here was never admitted, so there is no
  // budget hold to take and none to leak.
  //
  // The acknowledgement carries the amount rather than a bare flag, so a retry
  // only proceeds while the estimate is still no worse than what the user was
  // shown. The comparison is `>` against a positive threshold because 0 means
  // "never ask" — an operator who types 0 wants no prompt at all, not a prompt
  // on every run.
  const expensiveThresholdMicroUsd = await getSetting<number>(
    SETTING_KEYS.agentExpensiveThresholdMicroUsd,
    settingDefault(SETTING_KEYS.agentExpensiveThresholdMicroUsd),
  );

  if (
    expensiveThresholdMicroUsd > 0 &&
    estimate.totalMicroUsd > expensiveThresholdMicroUsd &&
    (input.acknowledgedCostMicroUsd ?? 0) < estimate.totalMicroUsd
  ) {
    yield {
      type: 'cost.confirmation_required',
      userMessageId: input.userMessageId,
      estimatedMicroUsd: estimate.totalMicroUsd,
      thresholdMicroUsd: expensiveThresholdMicroUsd,
      explanation: estimate.explanation,
      confidence: estimate.confidence,
    };
    return;
  }

  const runId = newId(ID_PREFIX.agentRun);

  // Admission does not just *check* the estimate, it *holds* it. Checking alone
  // reads counters that only move at settlement, so runs started together each
  // saw the same room and all of them took it. See `reserveRunBudget`.
  const admission = await reserveRunBudget({
    context: billing,
    runId,
    estimatedChargeMicroUsd: estimate.totalMicroUsd,
    estimatedWeightedTokens: estimate.estimatedWeightedTokens,
  });

  if (!admission.allowed) {
    const code: AgentErrorCode =
      admission.guard.reason === 'payment_required' ? 'payment_required' : 'quota_exceeded';
    yield {
      type: 'error',
      code,
      message: admission.guard.message,
      retryable: false,
      actionLabel: admission.guard.actionLabel,
      actionHref: admission.guard.actionHref,
    };
    return;
  }

  const budgetHold = admission.hold;

  /* ---- Create the run + placeholder assistant message ------------------ */
  const assistantMessageId = newId(ID_PREFIX.message);
  const sequence = (conversation.messageCount ?? 0) + 1;

  // These two inserts sit between taking the hold and the loop's own `finally`,
  // so they are the one stretch where a throw would strand the hold until its
  // TTL. Handing it back here turns "the team loses headroom for half an hour"
  // into "the team loses nothing".
  try {
    await db.insert(agentRuns).values({
      id: runId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      teamId: input.teamId,
      userId: input.userId,
      sandboxId: sandbox?.id ?? null,
      modelId: model.modelId,
      mode: input.mode,
      status: 'running',
      title: 'Agent run',
      maxIterations: iterationCeiling,
      startedAt: new Date(),
    });

    await db.insert(messages).values({
      id: assistantMessageId,
      conversationId: input.conversationId,
      runId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      modelId: model.modelId,
      agentMode: input.mode,
      sequence,
    });
  } catch (error) {
    await releaseRunBudget(budgetHold);
    throw error;
  }

  yield {
    type: 'run.start',
    runId,
    messageId: assistantMessageId,
    conversationId: input.conversationId,
    mode: input.mode,
    modelSlug: model.modelSlug,
    modelDisplayName: model.displayName,
    startedAt: new Date().toISOString(),
  };

  if (sandbox) {
    yield {
      type: 'sandbox.status',
      sandboxId: sandbox.id,
      status: sandbox.status,
      memoryLimitMb: sandbox.memoryMb,
    };
  }

  /* ---- The loop -------------------------------------------------------- */

  const conversationMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  const tools: ToolDefinition[] =
    input.mode === 'ask'
      ? []
      : [...availableTools(permissions), ...mcp.definitions.slice(0, MAX_MCP_TOOLS)];

  const fileChanges: Array<{
    path: string;
    kind: 'created' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
    pending: boolean;
    diff?: string;
  }> = [];

  const planSteps: Array<{
    id: string;
    title: string;
    status: PlanStepStatus;
    detail?: string;
  }> = [];

  const totals = {
    input: 0,
    output: 0,
    cached: 0,
    cacheWrite: 0,
    weighted: 0,
    charged: 0,
    upstream: 0,
  };
  let assistantText = '';
  let thinkingText = '';
  let finishReason = 'stop';
  let runStatus: 'succeeded' | 'failed' | 'cancelled' | 'awaiting_approval' = 'succeeded';
  let awaitingApproval = false;
  let toolSequence = 0;
  let timeToFirstTokenMs: number | undefined;

  const maxIterations = iterationCeiling;
  let iteration = 0;

  try {
    while (iteration < maxIterations) {
      iteration += 1;

      // Re-check before every model call, not just once before the first.
      // `recordModelUsage` mutates `billing` as the run spends, so this is the
      // only thing that stops a long run from crossing the spend cap or credit
      // limit mid-flight — the pre-flight check is an estimate, this is the
      // actual position. The first iteration is already covered above.
      if (iteration > 1) {
        const ongoing = checkSpendGuard({
          estimatedChargeMicroUsd: 0,
          balanceMicroUsd: billing.balanceMicroUsd,
          creditLimitMicroUsd: billing.creditLimitMicroUsd,
          quotaRemainingWeighted: billing.quotaRemainingWeighted,
          estimatedWeightedTokens: 0,
          spendCapMicroUsd: billing.spendCapMicroUsd,
          periodSpendMicroUsd: billing.periodSpendMicroUsd,
          hasActiveSubscription: billing.hasActiveSubscription,
          subscriptionStatus: billing.subscriptionStatus ?? undefined,
        });

        if (!ongoing.allowed) {
          yield {
            type: 'error',
            code: ongoing.reason === 'payment_required' ? 'payment_required' : 'quota_exceeded',
            message: ongoing.message,
            retryable: false,
            actionLabel: ongoing.actionLabel,
            actionHref: ongoing.actionHref,
          };
          runStatus = 'failed';
          break;
        }
      }

      const pendingToolCalls: Array<{ id: string; name: string; args: string }> = [];
      let iterationText = '';
      const iterationStart = Date.now();

      let stream: AsyncIterable<CompletionChunk>;
      try {
        stream = withStreamStallGuard(
          model.provider.stream({
            modelSlug: model.modelSlug,
            messages: conversationMessages,
            tools: tools.length ? tools : undefined,
            maxOutputTokens: Math.min(model.maxOutputTokens || 8192, 8192),
            signal: upstreamAbort.signal,
            apiKey: model.byok?.apiKey,
            baseUrl: model.byok?.baseUrl,
            requestId: runId,
          }),
          (reason) => upstreamAbort.abort(new Error(reason)),
        );
      } catch (error) {
        yield* handleProviderFailure(error);
        runStatus = 'failed';
        break;
      }

      let iterationUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
      };

      try {
        for await (const chunk of stream) {
          if (input.signal?.aborted) {
            runStatus = 'cancelled';
            finishReason = 'stopped_by_user';
            break;
          }

          if (Date.now() > turnDeadline) {
            upstreamAbort.abort(new Error('Turn deadline reached.'));
            yield errorEvent(
              'internal',
              'This turn reached its time limit and was stopped cleanly. Nothing was lost — send a follow-up message to continue where it left off.',
              true,
            );
            runStatus = 'failed';
            finishReason = 'turn_deadline';
            break;
          }

          switch (chunk.type) {
            case 'text':
              timeToFirstTokenMs ??= Date.now() - startedAt;
              iterationText += chunk.text;
              assistantText += chunk.text;
              yield { type: 'text.delta', text: chunk.text };
              break;

            case 'thinking':
              thinkingText += chunk.text;
              yield { type: 'thinking.delta', text: chunk.text };
              break;

            case 'tool_call_start':
              pendingToolCalls.push({ id: chunk.id, name: chunk.name, args: '' });
              break;

            case 'tool_call_delta': {
              const entry = pendingToolCalls.find((c) => c.id === chunk.id);
              if (entry) entry.args += chunk.argumentsDelta;
              break;
            }

            case 'tool_call_end': {
              const entry = pendingToolCalls.find((c) => c.id === chunk.id);
              if (entry) entry.args = chunk.arguments;
              else
                pendingToolCalls.push({
                  id: chunk.id,
                  name: chunk.name,
                  args: chunk.arguments,
                });
              break;
            }

            case 'usage':
              iterationUsage = chunk.usage;
              break;

            case 'done':
              finishReason = chunk.finishReason;
              break;
          }
        }
      } catch (error) {
        // Record the failed call before leaving the loop. Breaking straight out
        // skipped metering entirely, which broke the documented "exactly one
        // event row per request" invariant, lost the tokens the provider had
        // already consumed before it failed, and left the admin "Provider
        // failures" tile able to count only user cancellations. `status: 'error'`
        // makes `recordModelUsage` charge nothing, so this records without
        // billing for a failure.
        await recordModelUsage({
          context: billing,
          userId: input.userId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          messageId: assistantMessageId,
          runId,
          providerKey: model.providerKey,
          modelId: model.modelId,
          modelSlug: model.modelSlug,
          modelPriceId: model.priceId,
          counts: {
            inputTokens: iterationUsage.inputTokens,
            outputTokens: iterationUsage.outputTokens,
            cachedInputTokens: iterationUsage.cachedInputTokens,
            cacheWriteTokens: iterationUsage.cacheWriteTokens,
          },
          prices: model.prices,
          usedByok: Boolean(model.byok),
          latencyMs: Date.now() - iterationStart,
          status: 'error',
          errorCode: error instanceof ProviderError ? error.code : 'internal',
        });

        yield* handleProviderFailure(error);
        runStatus = 'failed';
        break;
      }

      /* ---- Meter this model call ------------------------------------- */

      const settlement = await recordModelUsage({
        context: billing,
        userId: input.userId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: assistantMessageId,
        runId,
        providerKey: model.providerKey,
        modelId: model.modelId,
        modelSlug: model.modelSlug,
        modelPriceId: model.priceId,
        counts: {
          inputTokens: iterationUsage.inputTokens,
          outputTokens: iterationUsage.outputTokens,
          cachedInputTokens: iterationUsage.cachedInputTokens,
          cacheWriteTokens: iterationUsage.cacheWriteTokens,
        },
        prices: model.prices,
        usedByok: Boolean(model.byok),
        latencyMs: Date.now() - iterationStart,
        status: runStatus === 'cancelled' ? 'cancelled' : 'success',
      });

      totals.input += iterationUsage.inputTokens;
      totals.output += iterationUsage.outputTokens;
      totals.cached += iterationUsage.cachedInputTokens;
      totals.cacheWrite += iterationUsage.cacheWriteTokens;
      totals.weighted += settlement.weightedTokens;
      totals.charged += settlement.chargedMicroUsd;
      totals.upstream += settlement.upstreamCostMicroUsd;

      if (runStatus === 'cancelled') break;

      /* ---- No tools called → we're done ------------------------------ */

      if (pendingToolCalls.length === 0) break;

      conversationMessages.push({
        role: 'assistant',
        content: iterationText,
        toolCalls: pendingToolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.args,
        })),
      });

      /* ---- Execute the tools ----------------------------------------- */

      const toolContext: ToolContext = {
        projectId: input.projectId,
        sandboxId: sandbox?.id ?? null,
        provider: sandboxProvider,
        permissions,
        knownSecrets: context.knownSecrets,
        runId,
        onFileChange: (change) => {
          fileChanges.push(change);
        },
      };

      for (const call of pendingToolCalls) {
        if (input.signal?.aborted) {
          runStatus = 'cancelled';
          break;
        }

        toolSequence += 1;
        const dbToolCallId = newId(ID_PREFIX.toolCall);
        let args: Record<string, unknown> = {};
        try {
          args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }

        const changesBefore = fileChanges.length;
        const mcpRoute = mcp.routes.get(call.name);

        yield {
          type: 'tool.start',
          toolCallId: dbToolCallId,
          toolName: call.name,
          source: mcpRoute ? 'mcp' : 'builtin',
          title: describeToolCall(call.name, args),
          args,
          requiresApproval: mcpRoute?.requiresApproval === true,
        };

        await db.insert(toolCallsTable).values({
          id: dbToolCallId,
          runId,
          messageId: assistantMessageId,
          externalCallId: call.id,
          toolName: call.name,
          source: mcpRoute ? 'mcp' : 'builtin',
          args,
          status: 'running',
          sequence: toolSequence,
        });

        const handler = BUILTIN_TOOL_HANDLERS[call.name];
        const toolStart = Date.now();

        let result;
        if (mcpRoute) {
          result = await runMcpToolCall(mcpRoute, args);
        } else if (!handler) {
          result = {
            output: `Unknown tool: ${call.name}`,
            summary: `Unknown tool: ${call.name}`,
            isError: true,
          };
        } else {
          try {
            result = await handler(args, toolContext);
          } catch (error) {
            result = {
              output: error instanceof Error ? error.message : 'Tool execution failed.',
              summary: 'Tool execution failed',
              isError: true,
            };
          }
        }

        const durationMs = Date.now() - toolStart;
        const status = result.needsApproval
          ? ('awaiting_approval' as const)
          : result.isError
            ? ('failed' as const)
            : ('succeeded' as const);

        await db
          .update(toolCallsTable)
          .set({
            result: result.output.slice(0, 100_000),
            resultSummary: result.summary,
            status,
            isError: result.isError,
            exitCode: result.exitCode ?? null,
            durationMs,
            requiresApproval: Boolean(result.needsApproval),
            updatedAt: new Date(),
          })
          .where(eq(toolCallsTable.id, dbToolCallId));

        if (result.output) {
          yield { type: 'tool.delta', toolCallId: dbToolCallId, chunk: result.output };
        }

        yield {
          type: 'tool.end',
          toolCallId: dbToolCallId,
          status,
          resultSummary: result.summary,
          isError: result.isError,
          exitCode: result.exitCode,
          durationMs,
        };

        for (const change of fileChanges.slice(changesBefore)) {
          yield { type: 'file.change', ...change };
        }

        if (result.needsApproval) {
          awaitingApproval = true;
          yield {
            type: 'approval.required',
            toolCallId: dbToolCallId,
            kind: mcpRoute ? 'tool' : call.name === 'run_command' ? 'command' : 'file',
            title: describeToolCall(call.name, args),
            reason: result.needsApproval.reason,
            preview: result.needsApproval.preview,
          };
        }

        conversationMessages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: sanitizeToolOutput(
            result.output || (result.isError ? 'Tool failed.' : 'Done.'),
            context.knownSecrets,
          ),
        });

        if (
          call.name === 'run_command' ||
          call.name === 'write_file' ||
          call.name === 'edit_file'
        ) {
          upsertPlanStep(
            planSteps,
            describeToolCall(call.name, args),
            result.isError ? 'failed' : 'done',
          );
          yield { type: 'plan.update', steps: [...planSteps] };
        }
      }

      if (awaitingApproval) {
        runStatus = 'awaiting_approval';
        break;
      }
      if (runStatus === 'cancelled') break;

      if (iteration >= maxIterations) {
        yield {
          type: 'notice',
          level: 'warning',
          message: `Stopped after ${maxIterations} steps to avoid an unbounded run. Send another message to continue.`,
        };
        finishReason = 'max_iterations';
      }
    }
  } catch (error) {
    log.error('Agent run failed', { runId, error: String(error) });
    yield errorEvent(
      'internal',
      'The run failed unexpectedly. Your conversation is saved.',
      true,
    );
    runStatus = 'failed';
  } finally {
    // Every exit path hands the hold back, including the one that is easy to
    // miss: a client that disconnects mid-stream abandons this generator, and
    // JS runs `finally` on generator return. By this point the loop is over and
    // `recordModelUsage` has moved the real numbers into `usage_periods`, so
    // releasing here cannot open a window. Only a killed process leaves a hold
    // behind, which is what the TTL exists for.
    await releaseRunBudget(budgetHold);
  }

  /* ---- Persist and close out ------------------------------------------ */

  const usage: StreamUsage = {
    inputTokens: totals.input,
    outputTokens: totals.output,
    cachedInputTokens: totals.cached,
    weightedTokens: totals.weighted,
    chargedMicroUsd: totals.charged,
    upstreamCostMicroUsd: totals.upstream,
    settlement: model.byok ? 'byok' : totals.charged > 0 ? 'payg' : 'quota',
    explanation: buildUsageExplanation(totals, model.prices, Boolean(model.byok)),
    latencyMs: Date.now() - startedAt,
    timeToFirstTokenMs,
  };

  const finalStatus =
    runStatus === 'cancelled' ? 'stopped' : runStatus === 'failed' ? 'failed' : 'complete';

  await db
    .update(messages)
    .set({
      content: assistantText,
      thinking: thinkingText || null,
      status: finalStatus,
      inputTokens: totals.input,
      outputTokens: totals.output,
      cachedInputTokens: totals.cached,
      weightedTokens: totals.weighted,
      upstreamCostMicroUsd: totals.upstream,
      chargedMicroUsd: totals.charged,
      latencyMs: usage.latencyMs,
      timeToFirstTokenMs: timeToFirstTokenMs ?? null,
      finishReason,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, assistantMessageId));

  await db
    .update(agentRuns)
    .set({
      status: runStatus === 'awaiting_approval' ? 'awaiting_approval' : runStatus,
      iterations: iteration,
      totalInputTokens: totals.input,
      totalOutputTokens: totals.output,
      totalWeightedTokens: totals.weighted,
      totalChargedMicroUsd: totals.charged,
      usedByok: Boolean(model.byok),
      stopReason: finishReason,
      steps: planSteps,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));

  await db
    .update(conversations)
    .set({
      messageCount: sql`${conversations.messageCount} + 1`,
      totalInputTokens: sql`${conversations.totalInputTokens} + ${totals.input}`,
      totalOutputTokens: sql`${conversations.totalOutputTokens} + ${totals.output}`,
      totalWeightedTokens: sql`${conversations.totalWeightedTokens} + ${totals.weighted}`,
      totalChargedMicroUsd: sql`${conversations.totalChargedMicroUsd} + ${totals.charged}`,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, input.conversationId));

  yield { type: 'usage', usage };
  yield {
    type: 'run.end',
    runId,
    status:
      runStatus === 'awaiting_approval'
        ? 'awaiting_approval'
        : runStatus === 'cancelled'
          ? 'cancelled'
          : runStatus === 'failed'
            ? 'failed'
            : 'succeeded',
    finishReason,
    usage,
    durationMs: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------------ *
 *  Context loading
 * ------------------------------------------------------------------ */

type RunContext = {
  project: typeof projects.$inferSelect;
  conversation: typeof conversations.$inferSelect;
  permissions: AgentPermissions;
  sandbox: typeof sandboxes.$inferSelect | null;
  sandboxProvider: SandboxProvider | null;
  model: Awaited<ReturnType<typeof resolveModel>>;
  history: ChatMessage[];
  systemPrompt: string;
  billing: Awaited<ReturnType<typeof loadBillingContext>>;
  knownSecrets: string[];
  /** Set when an inherited, unreachable model was replaced by the default. */
  modelNotice: string | null;
  /** Namespaced MCP tool definitions plus the routes that execute them. */
  mcp: Awaited<ReturnType<typeof loadToolsForProject>>;
};

async function loadRunContext(
  input: RunAgentInput,
): Promise<
  RunContext | { error: { code: AgentErrorCode; message: string; retryable: boolean } }
> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) {
    return { error: { code: 'internal', message: 'Project not found.', retryable: false } };
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conversation) {
    return {
      error: { code: 'internal', message: 'Conversation not found.', retryable: false },
    };
  }

  const permissions = resolveAgentPermissions(
    project.permissions as Partial<AgentPermissions> | null,
    input.mode,
  );

  const [sandbox] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, input.projectId), eq(sandboxes.status, 'running')))
    .limit(1);

  const sandboxProvider = sandbox
    ? getProvider(sandbox.provider as Parameters<typeof getProvider>[0])
    : null;

  /*
   * Only `input.modelId` is a choice made for *this* turn. The other two are
   * inherited: a conversation keeps whatever it was created with, and a project
   * default is usually whatever the seed wrote. `resolveModel` refuses a named
   * model whose provider has no credentials — correctly, because simulating a
   * reply and attributing it to a model somebody deliberately picked is worse
   * than an error. But that reasoning does not extend to an id nobody picked:
   * a project seeded with a default on a provider the operator never configured
   * made *every* run in it fail, including the first message a new user ever
   * sends. Falling back to the catalogue default — which `loadDefaultModel`
   * already biases towards configured providers — is the honest answer, said out
   * loud rather than silently.
   */
  const explicitModelId = input.modelId ?? null;
  const inheritedModelId = conversation.modelId ?? project.defaultModelId;

  let model: Awaited<ReturnType<typeof resolveModel>>;
  let modelNotice: string | null = null;
  try {
    model = await resolveModel({
      modelId: explicitModelId ?? inheritedModelId,
      userId: input.userId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.error('Model resolution failed', { error: reason, explicit: Boolean(explicitModelId) });

    // A deliberate pick fails loudly, and with the reason it actually failed
    // for. The generic "an administrator needs to configure the model
    // catalogue" that used to be returned here was wrong whenever the catalogue
    // was fine and one provider's key was missing — it pointed the user at
    // someone else when the fix was to choose another model.
    if (explicitModelId) {
      return { error: { code: 'model_unavailable', message: reason, retryable: false } };
    }

    try {
      model = await resolveModel({ userId: input.userId });
      modelNotice = `${reason} This run used ${model.displayName} instead.`;
    } catch (fallbackError) {
      log.error('Default model resolution failed', { error: String(fallbackError) });
      return {
        error: {
          code: 'model_unavailable',
          message:
            'No model is available. An administrator needs to configure the model catalogue.',
          retryable: false,
        },
      };
    }
  }

  const billing = await loadBillingContext(input.teamId);

  const fileRows = await db
    .select({ path: projectFiles.path })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, input.projectId))
    .orderBy(asc(projectFiles.path))
    .limit(400);

  const activeSkills = await db
    .select({ name: skillsTable.name, instructions: skillsTable.instructions })
    .from(installedSkills)
    .innerJoin(skillsTable, eq(installedSkills.skillId, skillsTable.id))
    .where(and(eq(installedSkills.teamId, input.teamId), eq(installedSkills.isEnabled, true)))
    .limit(10);

  // MCP tools ride along only when the mode and the project's permissions
  // allow them. `loadToolsForProject` skips unreachable servers rather than
  // failing the run — a broken connection in settings must not take chat down.
  const mcp =
    input.mode !== 'ask' && permissions.useMcpTools
      ? await loadToolsForProject(input.teamId, input.projectId)
      : { definitions: [], routes: new Map() };

  // The prompt summary is capped hard: a server exposing fifty tools would
  // otherwise eat the context window before the first user message.
  const mcpSummary = mcp.definitions.slice(0, MAX_MCP_TOOLS).map((definition) => {
    const [, server, name] = definition.name.split('__');
    return {
      server: server ?? 'mcp',
      name: name ?? definition.name,
      description: definition.description.slice(0, 200),
    };
  });

  const systemPrompt = buildSystemPrompt({
    mode: input.mode,
    permissions,
    projectName: project.name,
    projectDescription: project.description,
    template: project.template,
    shell: project.defaultShell,
    sandboxAvailable: Boolean(sandbox),
    sandboxStatus: sandbox?.status ?? 'none',
    demoMode: env.DEMO_MODE,
    fileTree: fileRows.map((f) => f.path),
    skills: activeSkills,
    mcpTools: mcpSummary,
  });

  const history = await loadHistory(input.conversationId, model.contextWindow);

  // Project environment values are secrets as far as tool output is concerned.
  const knownSecrets = Object.values(
    (project.envVars as Record<string, string> | null) ?? {},
  ).filter((v) => typeof v === 'string' && v.length >= 8);

  return {
    project,
    conversation,
    permissions,
    sandbox: sandbox ?? null,
    sandboxProvider,
    model,
    history,
    systemPrompt,
    billing,
    knownSecrets,
    modelNotice,
    mcp,
  };
}

/**
 * Loads prior turns, newest-first, until roughly 55% of the context window is
 * used — leaving room for the system prompt, tool output and the response.
 */
async function loadHistory(
  conversationId: string,
  contextWindow: number,
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sequence))
    .limit(200);

  const budget = Math.max(4_000, Math.floor((contextWindow || 128_000) * 0.55));
  const selected: ChatMessage[] = [];
  let used = 0;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.status === 'streaming' || row.status === 'pending') continue;
    if (!row.content.trim()) continue;

    const tokens = estimateTokens(row.content);
    if (used + tokens > budget && selected.length > 0) break;
    used += tokens;

    if (row.role === 'user') selected.unshift({ role: 'user', content: row.content });
    else if (row.role === 'assistant')
      selected.unshift({ role: 'assistant', content: row.content });
    else if (row.role === 'system') selected.unshift({ role: 'system', content: row.content });
  }

  return selected;
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

function availableTools(permissions: AgentPermissions): ToolDefinition[] {
  return BUILTIN_TOOL_DEFINITIONS.filter((tool) => {
    switch (tool.name) {
      case 'write_file':
      case 'edit_file':
        return permissions.writeFiles;
      case 'delete_file':
        return permissions.writeFiles;
      case 'run_command':
        return permissions.runCommands;
      case 'web_fetch':
        return permissions.networkAccess;
      default:
        return permissions.readFiles;
    }
  });
}

function describeToolCall(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : '';
  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__');
    return tool ? `MCP ${server} · ${tool}` : name;
  }
  switch (name) {
    case 'read_file':
      return `Read ${path}`;
    case 'write_file':
      return `Write ${path}`;
    case 'edit_file':
      return `Edit ${path}`;
    case 'delete_file':
      return `Delete ${path}`;
    case 'list_files':
      return `List ${path || '.'}`;
    case 'search_files':
      return `Search for ${typeof args.query === 'string' ? args.query : ''}`;
    case 'run_command':
      return typeof args.command === 'string' ? `$ ${args.command}` : 'Run command';
    case 'web_fetch':
      return `Fetch ${typeof args.url === 'string' ? args.url : ''}`;
    default:
      return name;
  }
}

function upsertPlanStep(
  steps: Array<{ id: string; title: string; status: PlanStepStatus; detail?: string }>,
  title: string,
  status: PlanStepStatus,
): void {
  const existing = steps.find((s) => s.title === title);
  if (existing) existing.status = status;
  else steps.push({ id: newId(ID_PREFIX.task), title, status });
}

/**
 * Executes one namespaced MCP tool call inside the run loop.
 *
 * Destructive tools (per the server's approval policy) come back as a
 * `needsApproval` result — the same pause-and-ask flow builtin tools use — and
 * the approval endpoint re-runs them through `callTool` once a human agrees.
 * Output is already bounded by the manager (60 s timeout) and is redacted and
 * truncated with the rest of the tool output before it reaches the model.
 */
/** Exported for tests: the approval gate and the manager hand-off. */
export async function runMcpToolCall(
  route: { serverId: string; toolName: string; requiresApproval: boolean },
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (route.requiresApproval) {
    return {
      output: '',
      summary: 'Awaiting approval',
      isError: false,
      needsApproval: {
        reason:
          'This tool belongs to an MCP server and can change external state, so it needs a human go-ahead.',
        preview: JSON.stringify(args, null, 2).slice(0, 2_000),
      },
    };
  }

  const { output, isError } = await callTool(route.serverId, route.toolName, args);
  return {
    output,
    summary: `${route.toolName} (MCP)`,
    isError,
  };
}

/** ~3.8 characters per token is close enough for budgeting, and never lies high. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

function textOf(message: ChatMessage): string {
  if (typeof (message as { content?: unknown }).content === 'string') {
    return (message as { content: string }).content;
  }
  return '';
}

function buildUsageExplanation(
  totals: { input: number; output: number; cached: number; weighted: number; charged: number },
  prices: { inputMicroUsdPerMtok: number; outputMicroUsdPerMtok: number },
  byok: boolean,
): string {
  if (byok) {
    return 'Billed directly to your own API key — no Karo model credits were used.';
  }
  const multiplier =
    prices.inputMicroUsdPerMtok > 0
      ? Math.round((prices.outputMicroUsdPerMtok / prices.inputMicroUsdPerMtok) * 100) / 100
      : 4;
  return (
    `${totals.input.toLocaleString('en-US')} input × 1` +
    (totals.cached ? `  +  ${totals.cached.toLocaleString('en-US')} cached` : '') +
    `  +  ${totals.output.toLocaleString('en-US')} output × ${multiplier}` +
    `  =  ${totals.weighted.toLocaleString('en-US')} weighted tokens`
  );
}

function errorEvent(
  code: AgentErrorCode,
  message: string,
  retryable: boolean,
): AgentStreamEvent {
  return { type: 'error', code, message, retryable };
}

/**
 * Cutting an agent turn off on purpose, before the platform does it silently.
 */
const MAX_TURN_MS = 280_000;

/** Silence longer than this means the provider stream is dead, not thinking. */
const STREAM_STALL_MS = 90_000;

/**
 * Guards a model stream against a silent upstream: a provider that accepts the
 * connection and then never sends another byte would otherwise park the turn
 * forever — the function lives, the SSE never closes, the cursor blinks on.
 * Any chunk resets the timer; `stallMs` of nothing aborts the upstream
 * connection and surfaces a retryable error the model loop turns into a clean
 * "send again" for the user.
 */
async function* withStreamStallGuard(
  stream: AsyncIterable<CompletionChunk>,
  abort: (reason: string) => void,
  stallMs = STREAM_STALL_MS,
): AsyncGenerator<CompletionChunk> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: IteratorResult<CompletionChunk>;
      try {
        result = await Promise.race([
          iterator.next(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('stream stalled')), stallMs);
          }),
        ]);
      } catch {
        const reason = `The model stream went silent for ${Math.round(stallMs / 1000)} seconds and was cut off. This is usually a temporary provider hiccup — send the message again to retry.`;
        abort(reason);
        throw new Error(reason);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

function* handleProviderFailure(error: unknown): Generator<AgentStreamEvent> {
  if (error instanceof ProviderError) {
    const map: Record<ProviderError['code'], AgentErrorCode> = {
      unauthorized: 'provider_unavailable',
      rate_limited: 'rate_limited',
      unavailable: 'provider_unavailable',
      bad_request: 'internal',
      context_too_long: 'context_too_long',
      cancelled: 'cancelled',
      internal: 'internal',
    };
    yield {
      type: 'error',
      code: map[error.code],
      message: error.message,
      retryable: error.retryable,
    };
    return;
  }
  yield {
    type: 'error',
    code: 'internal',
    message: error instanceof Error ? error.message : 'The model provider failed.',
    retryable: true,
  };
}
