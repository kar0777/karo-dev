ALTER TABLE "plans" ADD COLUMN "coming_soon" boolean DEFAULT false NOT NULL;
-- Launch state: only pay-as-you-go is purchasable today; the subscription
-- tiers are advertised but not sold yet (the checkout refuses them and the
-- marketing page badges them "Coming soon").
UPDATE "plans" SET "coming_soon" = true WHERE "tier" <> 'payg';
