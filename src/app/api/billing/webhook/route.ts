import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { BillingError, getBillingProvider } from '@/lib/billing';
import { createLogger } from '@/lib/logger';

/**
 * Provider webhook.
 *
 * Unauthenticated by necessity and therefore hostile by assumption:
 *
 *  · the body is read **raw** (`req.text()`) because a signature is computed
 *    over exact bytes — parsing first would break verification;
 *  · CSRF is off: there is no session and no browser involved;
 *  · nothing in the payload is trusted before `provider.handleWebhook` has
 *    verified it. The only field this route touches is the event type it gets
 *    *back* from the provider, and even that is truncated before logging;
 *  · an unrecognised event type still returns 200. Providers disable endpoints
 *    that return errors, and "we don't act on this one" is not an error.
 *    A failed signature is the one case that must be 400.
 */

const log = createLogger('api:billing:webhook');

/** Enough for any real event name; caps what an unverified payload can log. */
const MAX_EVENT_TYPE_LENGTH = 120;

export const POST = defineHandler(
  {
    auth: 'none',
    csrf: false,
    rateLimit: 'webhook',
  },
  async ({ req }) => {
    const payload = await req.text();
    const signature = req.headers.get('stripe-signature');
    const provider = getBillingProvider();

    try {
      const result = await provider.handleWebhook({
        payload,
        signature,
        headers: req.headers,
      });

      const eventType = String(result.eventType ?? 'unknown').slice(0, MAX_EVENT_TYPE_LENGTH);

      await recordAudit({
        action: AUDIT_ACTIONS.billingWebhook,
        actorType: 'webhook',
        resourceType: 'billing',
        resourceId: result.eventId,
        summary: result.handled
          ? `Processed billing webhook ${eventType}`
          : `Ignored billing webhook ${eventType}`,
        metadata: { eventType, provider: provider.key, handled: result.handled },
        request: req,
      });

      return json({ received: true, handled: result.handled, eventType });
    } catch (error) {
      if (error instanceof BillingError) {
        // Signature problems are the provider's cue to stop retrying with the
        // same secret; everything else is worth a retry.
        const status = error.status === 400 ? 400 : error.status >= 500 ? 503 : 400;

        log.warn('Rejected a billing webhook', { code: error.code, status });

        await recordAudit({
          action: AUDIT_ACTIONS.billingWebhook,
          actorType: 'webhook',
          resourceType: 'billing',
          severity: 'warning',
          summary: `Rejected billing webhook: ${error.code}`,
          metadata: { code: error.code, provider: provider.key },
          request: req,
        });

        return json(
          {
            error: {
              code: status === 400 ? 'validation_error' : 'provider_unavailable',
              title: 'Webhook rejected',
              message: error.message,
            },
          },
          { status },
        );
      }

      log.error('Billing webhook handler failed', { error });
      return json(
        {
          error: {
            code: 'internal_error',
            title: 'Webhook could not be processed',
            message: 'The event was received but could not be processed. It will be retried.',
          },
        },
        { status: 500 },
      );
    }
  },
);
