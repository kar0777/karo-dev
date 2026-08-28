import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { attachRunId, registerRun } from '@/app/api/_shared/active-runs';
import { requireConversationAccess } from '@/app/api/_shared/conversation-access';
import { routeParam, titleFromMessage } from '@/app/api/_shared/route-helpers';
import { runAgent } from '@/lib/agent/runtime';
import { QuotaExceededError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { conversations, messageAttachments, messages } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { SSE_HEADERS, encodeSse, type AgentStreamEvent } from '@/lib/types/agent';

/**
 * `POST /api/conversations/[conversationId]/messages` — the chat endpoint.
 *
 * This is the one route where the response outlives the handler, so a few
 * things are non-negotiable:
 *
 *  · **The user's message is committed before the stream opens.** If the model
 *    provider is down, or the browser is closed a second later, what the user
 *    typed is still in their history.
 *  · **The client's disconnect cancels the run.** `request.signal` aborts the
 *    controller, `runAgent` sees it and finishes the run as *cancelled* — not
 *    failed — so nothing is charged past the last completed step and the UI does
 *    not offer to "retry" something the user deliberately walked away from.
 *  · **Errors travel inside the stream.** Tearing the connection down would give
 *    the client a network error with no code and no copy; instead the failure is
 *    emitted as an `error` event and the stream still closes with `run.end`.
 *  · **Every attempt has exactly one terminator.** `run.end` for a run that was
 *    created, `cost.confirmation_required` for one that was refused before it
 *    could be. The client leaves its streaming state on one or the other.
 *
 * The `AbortController` is parked in the active-run registry so
 * `POST /conversations/[id]/stop` — a different request entirely — can reach it.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:chat');

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255).default('application/octet-stream'),
  sizeBytes: z.number().int().min(0),
  /** Text small enough to inline. Binary attachments carry a storage key. */
  inlineContent: z.string().max(400_000).optional(),
  storageKey: z.string().max(512).optional(),
});

const body = z.object({
  content: z.string().min(1, 'Type a message first.').max(200_000),
  attachments: z.array(attachmentSchema).max(10).optional(),
  mode: z.enum(['ask', 'plan', 'build', 'auto']).optional(),
  modelId: z.string().trim().max(64).nullish(),
  /**
   * What the user was quoted and accepted after a `cost.confirmation_required`
   * refusal, micro-USD. Absent on a first attempt, which is why an expensive run
   * is refused once before it can ever be acknowledged.
   */
  acknowledgedCostMicroUsd: z.number().int().min(0).optional(),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'chat.message', body },
  async ({ params, body: input, user, req }) => {
    const conversationId = routeParam(params, 'conversationId');
    const access = await requireConversationAccess(conversationId, 'agent.run');
    const { conversation, project, team } = access;

    const mode = input.mode ?? conversation.agentMode;
    const attachments = input.attachments ?? [];

    /* ---- 1. Size guard ------------------------------------------------ */

    const maxBytes = await getSetting(
      SETTING_KEYS.limitsMaxUploadBytes,
      settingDefault(SETTING_KEYS.limitsMaxUploadBytes),
    );
    for (const attachment of attachments) {
      if (attachment.sizeBytes > maxBytes) {
        throw new QuotaExceededError(
          `"${attachment.filename}" is ${Math.round(attachment.sizeBytes / 1024 / 1024)} MB and the attachment limit is ${Math.round(
            maxBytes / 1024 / 1024,
          )} MB. Upload it into the workspace instead and ask the agent to open it.`,
          {
            details: {
              filename: attachment.filename,
              sizeBytes: attachment.sizeBytes,
              maxBytes,
            },
          },
        );
      }
    }

    /* ---- 2. Persist the user's turn ----------------------------------- */

    const userMessageId = newId(ID_PREFIX.message);
    const sequence = conversation.messageCount + 1;

    // Text attachments are folded into the message body: the agent reads
    // `content` and nothing else, so a file the user attached has to be *in*
    // the turn or the agent simply never sees it. The attachment row keeps the
    // filename and size for the UI chip; its inline copy is dropped to avoid
    // storing the same bytes twice.
    const inlined = attachments.filter(
      (attachment) =>
        typeof attachment.inlineContent === 'string' && attachment.inlineContent.length > 0,
    );
    const content = inlined.length
      ? [
          input.content,
          ...inlined.map(
            (attachment) =>
              `Attached file — ${attachment.filename}:\n\`\`\`\n${attachment.inlineContent}\n\`\`\``,
          ),
        ].join('\n\n')
      : input.content;

    await db.insert(messages).values({
      id: userMessageId,
      conversationId,
      role: 'user',
      content,
      status: 'complete',
      agentMode: mode,
      sequence,
    });

    if (attachments.length > 0) {
      await db.insert(messageAttachments).values(
        attachments.map((attachment) => ({
          id: newId(ID_PREFIX.attachment),
          messageId: userMessageId,
          kind: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          inlineContent: null,
          storageKey: attachment.storageKey ?? null,
        })),
      );
    }

    /* ---- 3. Name the chat from its first message ---------------------- */

    const autoTitle =
      conversation.title === 'New chat' ? titleFromMessage(input.content) : null;

    await db
      .update(conversations)
      .set({
        messageCount: sequence,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        ...(autoTitle ? { title: autoTitle } : {}),
        ...(input.modelId !== undefined && input.modelId !== null
          ? { modelId: input.modelId }
          : {}),
      })
      .where(eq(conversations.id, conversationId));

    await recordAudit({
      action: AUDIT_ACTIONS.agentRunStart,
      teamId: team.id,
      userId: user.id,
      resourceType: 'conversation',
      resourceId: conversationId,
      summary: `Started a ${mode} run in ${project.name}`,
      metadata: { mode, projectId: project.id, attachments: attachments.length },
    });

    /* ---- 4. Stream the run -------------------------------------------- */

    const controller = new AbortController();
    const release = registerRun(conversationId, controller);

    // A closed tab, a navigation, a dropped connection — all of them land here.
    const onClientAbort = () => controller.abort();
    req.signal.addEventListener('abort', onClientAbort, { once: true });

    const encoder = new TextEncoder();
    let runId: string | null = null;
    let sawRunEnd = false;
    let sawCostConfirmation = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        /**
         * Enqueueing into a stream the client has abandoned throws. That must
         * not abort the loop: `runAgent` still has to reach its own cleanup so
         * the run is persisted as cancelled rather than left `running` forever.
         */
        let clientGone = false;
        const send = (event: AgentStreamEvent) => {
          if (clientGone) return;
          try {
            streamController.enqueue(encoder.encode(encodeSse(event)));
          } catch {
            clientGone = true;
          }
        };

        try {
          for await (const event of runAgent({
            conversationId,
            projectId: project.id,
            teamId: team.id,
            userId: user.id,
            userMessageId,
            mode,
            // Only what the caller chose for *this* turn. Collapsing the
            // conversation and project fallbacks in here made every inherited
            // id look like a deliberate pick, so `runAgent` could not tell the
            // two apart — and a project whose seeded default sat on an
            // unconfigured provider failed every run instead of falling back.
            // The runtime holds both rows already and applies the chain itself.
            modelId: input.modelId ?? null,
            signal: controller.signal,
            ...(input.acknowledgedCostMicroUsd === undefined
              ? {}
              : { acknowledgedCostMicroUsd: input.acknowledgedCostMicroUsd }),
          })) {
            if (event.type === 'run.start') {
              runId = event.runId;
              attachRunId(conversationId, event.runId);
            }
            if (event.type === 'run.end') sawRunEnd = true;
            if (event.type === 'cost.confirmation_required') sawCostConfirmation = true;
            send(
              event.type === 'run.start'
                ? // The title was decided a few lines above, after this stream's
                  // caller had already rendered its copy of the row. Sending the
                  // current one lets the sidebar rename itself live.
                  { ...event, conversationTitle: autoTitle ?? conversation.title }
                : event,
            );
          }
        } catch (error) {
          log.error('Agent stream failed', {
            conversationId,
            projectId: project.id,
            error: String(error),
          });
          send({
            type: 'error',
            code: 'internal',
            message:
              'The run stopped unexpectedly. Your conversation is saved — send the message again to retry.',
            retryable: true,
            actionLabel: 'Retry',
          });
        } finally {
          // Exactly one terminator, whatever happened above — but a run refused
          // for cost confirmation already sent its own. Synthesising a failed
          // `run.end` after that would report the failure of a run that was
          // never created, and would push the client out of the confirm/cancel
          // state the refusal just put it into.
          if (!sawRunEnd && !sawCostConfirmation) {
            send({
              type: 'run.end',
              runId: runId ?? '',
              status: controller.signal.aborted ? 'cancelled' : 'failed',
              finishReason: controller.signal.aborted ? 'stopped_by_user' : 'error',
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cachedInputTokens: 0,
                weightedTokens: 0,
                chargedMicroUsd: 0,
                upstreamCostMicroUsd: 0,
                settlement: 'quota',
                explanation: 'The run ended before any tokens were billed.',
                latencyMs: 0,
              },
              durationMs: 0,
            });
          }

          req.signal.removeEventListener('abort', onClientAbort);
          release();

          try {
            streamController.close();
          } catch {
            /* already closed by the client disconnecting */
          }
        }
      },

      cancel() {
        controller.abort();
      },
    });

    return new Response(stream, { headers: { ...SSE_HEADERS } });
  },
);
