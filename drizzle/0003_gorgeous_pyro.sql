CREATE TYPE "public"."byos_command_status" AS ENUM('queued', 'claimed', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "byos_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "byos_command_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"timeout_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "byos_commands" ADD CONSTRAINT "byos_commands_worker_id_byos_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."byos_workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "byos_commands_worker_idx" ON "byos_commands" USING btree ("worker_id","status","created_at");