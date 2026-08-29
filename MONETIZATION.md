# Monetization runbook

How this install pays for itself, and where every lever lives. The unit
economics behind each number are visible live in **Admin → Costs** (revenue,
margin and break-even per plan tier and per model).

## The take rate: platform margin

Every pay-as-you-go request is billed at **upstream provider cost + margin**.
Settlement reads the margin from the plan row (`plans.margin_bps`); the
platform default for newly created plans is `billing.platform_margin_bps`.

| Lever | Where | Default |
| --- | --- | --- |
| Margin of an existing plan | Admin → Plans → that plan → `marginBps` | pay-as-you-go: **3500 (+35%)** |
| Margin for newly created plans | Admin → Settings → `billing.platform_margin_bps` | **3500 (+35%)** |
| Published per-token overage for subscription tiers | Admin → Plans | per plan |

Rules of thumb:

- Hosting is on free tiers, so **margin is profit** — the only real costs are
  the provider tokens users spend (billed to the operator's own provider
  accounts) and Stripe's 2.9% + $0.30 per payment. A 35% margin comfortably
  clears Stripe's fee.
- Raising `marginBps` changes what runs cost **immediately** for that plan; it
  never rewrites history (price attribution is per usage event).
- BYOK runs bill nothing to Karo by design — the user pays their own provider.
  Compute on their own hardware is free for the same reason. That is fine:
  those users cost nothing either.

## Deposit bonuses

Bigger top-ups earn bonus credit (`TOPUP_BONUS_TIERS` in
`src/lib/billing/credit.ts`):

- **$50+ → +5%**
- **$100+ → +10%**

The bonus lands with the payment (Stripe webhook or the simulated checkout),
is recorded in `topups.bonus_micro_usd`, and counts toward the balance but
never toward "lifetime topped up" — real money in stays distinguishable from
promo credit. Tune the tiers in that one constant; the balance card badges
update themselves.

## Conversion mechanics already wired

- New workspaces can run immediately: the PAYG credit limit (Admin →
  Settings → `billing.payg_credit_limit_micro_usd`, default $2) lets a first
  session go slightly negative before anything is refused.
- Auto top-up keeps long-running users spending without checkout friction
  (team setting in Billing), with a 15-minute claim window and automatic
  pausing after repeated failures.
- Coupons (Admin → Coupons): bonus-credit codes for acquisition, percent-off
  codes for closing a specific plan — redeemed in Billing, never in Stripe
  checkout.

## Going live with payments

1. Stripe → **Switch to live account** → copy `sk_live_…`.
2. Create the webhook endpoint (`/api/billing/webhook`) in the live account and
   copy its signing secret.
3. Vercel: replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the
   live values → Redeploy. Test mode payments never carry over.

## Watching the numbers

- **Admin → Costs** — revenue, margin and break-even per plan and per model.
- **Admin → Usage** — who is spending what this period.
- **Stripe dashboard** — gross volume vs. payouts.
- The healthiest signal that pricing is right: margin per model on
  Admin → Costs stays positive after the provider's own price moves —
  catalogue sync updates upstream prices, and the margin rides on top.
