CREATE TYPE "public"."cli_auth_kind" AS ENUM('login', 'api_key', 'none');--> statement-breakpoint
CREATE TYPE "public"."cli_install_status" AS ENUM('installed', 'missing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."cli_license_kind" AS ENUM('free', 'proprietary');--> statement-breakpoint
CREATE TABLE "cli_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"license" text DEFAULT '' NOT NULL,
	"license_kind" "cli_license_kind" DEFAULT 'free' NOT NULL,
	"license_url" text,
	"docs_url" text,
	"auth_kind" "cli_auth_kind" DEFAULT 'none' NOT NULL,
	"auth_note" text DEFAULT '' NOT NULL,
	"api_key_env_var" text,
	"api_key_provider_key" text,
	"bin_name" text NOT NULL,
	"version_arg" text DEFAULT '--version' NOT NULL,
	"install_commands" jsonb NOT NULL,
	"launch_command" text DEFAULT '' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_cli_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"checked_by_id" text NOT NULL,
	"status" "cli_install_status" DEFAULT 'unknown' NOT NULL,
	"version" text,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_cli_installs" ADD CONSTRAINT "sandbox_cli_installs_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_cli_installs" ADD CONSTRAINT "sandbox_cli_installs_tool_id_cli_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."cli_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_cli_installs" ADD CONSTRAINT "sandbox_cli_installs_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_tools_slug_unique" ON "cli_tools" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_cli_installs_unique" ON "sandbox_cli_installs" USING btree ("sandbox_id","tool_id");--> statement-breakpoint
CREATE INDEX "sandbox_cli_installs_tool_idx" ON "sandbox_cli_installs" USING btree ("tool_id");