CREATE TABLE "usage_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"run_id" text,
	"weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"micro_usd" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_interval" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "auto_topup_last_charged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "auto_topup_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "auto_topup_last_error" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_reservations_team_period_idx" ON "usage_reservations" USING btree ("team_id","period_start");--> statement-breakpoint
CREATE INDEX "usage_reservations_expires_idx" ON "usage_reservations" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;