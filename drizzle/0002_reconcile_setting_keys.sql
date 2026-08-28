-- Reconciling `SETTING_KEYS` with the rows the seed actually writes turns rows
-- that were inert into rows that decide behaviour. One of them was shipped with
-- a value that contradicts how the product has been running.
--
-- `signup.require_email_verification` was seeded `true` from the beginning, but
-- the code looked the value up under a name nothing wrote and always fell back
-- to `false`. So every install has been running with verification off while its
-- admin console displayed "on". Now that the name matches, that row would take
-- effect on the next deploy and lock out every unconfirmed account at once —
-- a change nobody asked for, arriving as a side effect of a bug fix.
--
-- Only rows that still hold the original shipped value AND were never touched by
-- an operator are corrected. `updated_by_id` is non-null the moment a human
-- saves the row in `/admin/settings`, so an operator who deliberately wants
-- verification enforced keeps it — this only rewrites a default nobody chose.
UPDATE "admin_settings"
SET "value" = 'false'::jsonb,
    "updated_at" = now()
WHERE "key" = 'signup.require_email_verification'
  AND "value" = 'true'::jsonb
  AND "updated_by_id" IS NULL;
