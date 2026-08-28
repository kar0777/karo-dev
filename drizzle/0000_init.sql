CREATE TYPE "public"."agent_mode" AS ENUM('ask', 'plan', 'build', 'auto');--> statement-breakpoint
CREATE TYPE "public"."audit_severity" AS ENUM('info', 'notice', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('disconnected', 'connecting', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."email_token_kind" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."file_change_kind" AS ENUM('created', 'modified', 'deleted', 'renamed');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('sev1', 'sev2', 'sev3', 'sev4');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('stdio', 'http', 'sse');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'streaming', 'complete', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_level" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('payg', 'lite', 'pro', 'scale', 'ultra');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."plugin_category" AS ENUM('development', 'databases', 'deployment', 'browser', 'automation', 'testing', 'ai', 'communication');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."runtime_target" AS ENUM('karo_cloud', 'own_server', 'external_sandbox', 'local');--> statement-breakpoint
CREATE TYPE "public"."sandbox_status" AS ENUM('creating', 'starting', 'running', 'sleeping', 'stopping', 'stopped', 'failed', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."resource_scope" AS ENUM('account', 'project');--> statement-breakpoint
CREATE TYPE "public"."shell_kind" AS ENUM('bash', 'sh', 'powershell', 'cmd');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('pending', 'awaiting_approval', 'running', 'succeeded', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."topup_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('model', 'compute', 'storage', 'egress');--> statement-breakpoint
CREATE TYPE "public"."worker_status" AS ENUM('pending', 'online', 'offline', 'revoked');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sandbox_id" text,
	"model_id" text,
	"mode" "agent_mode" DEFAULT 'build' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"title" text DEFAULT 'Agent run' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_reason" text,
	"error_message" text,
	"iterations" integer DEFAULT 0 NOT NULL,
	"max_iterations" integer DEFAULT 24 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"total_charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"used_byok" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"user_id" text,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text DEFAULT '' NOT NULL,
	"resource_id" text,
	"severity" "audit_severity" DEFAULT 'info' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "byos_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "worker_status" DEFAULT 'pending' NOT NULL,
	"install_token_hash" text NOT NULL,
	"install_token_expires_at" timestamp with time zone NOT NULL,
	"worker_token_hash" text,
	"token_rotated_at" timestamp with time zone,
	"hostname" text,
	"platform" text,
	"arch" text,
	"agent_version" text,
	"capabilities" jsonb,
	"cpu_cores" real,
	"memory_mb" integer,
	"disk_gb" integer,
	"last_heartbeat_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compute_events" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"sandbox_id" text,
	"sandbox_session_id" text,
	"provider_key" text DEFAULT 'mock' NOT NULL,
	"cpu_cores" real DEFAULT 0.25 NOT NULL,
	"memory_mb" integer DEFAULT 512 NOT NULL,
	"disk_gb" integer DEFAULT 5 NOT NULL,
	"compute_multiplier" real DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"billed_compute_hours" real DEFAULT 0 NOT NULL,
	"upstream_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"gross_margin_micro_usd" bigint DEFAULT 0 NOT NULL,
	"settlement" text DEFAULT 'quota' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"model_id" text,
	"agent_mode" "agent_mode" DEFAULT 'build' NOT NULL,
	"summary" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"total_charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'skill' NOT NULL,
	"source_ref" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "email_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"response_hash" text,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"severity" "incident_severity" DEFAULT 'sev3' NOT NULL,
	"component" text DEFAULT 'platform' NOT NULL,
	"affected_teams" integer DEFAULT 0 NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"plugin_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"installed_by_id" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"secrets_ciphertext" text,
	"granted_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"health_status" "connection_status" DEFAULT 'disconnected' NOT NULL,
	"health_message" text,
	"last_health_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installed_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"installed_by_id" text NOT NULL,
	"scope" "resource_scope" DEFAULT 'account' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"config" jsonb,
	"secrets_ciphertext" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "team_role" DEFAULT 'developer' NOT NULL,
	"invited_by_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_micro_usd" bigint DEFAULT 0 NOT NULL,
	"tax_micro_usd" bigint DEFAULT 0 NOT NULL,
	"total_micro_usd" bigint DEFAULT 0 NOT NULL,
	"amount_paid_micro_usd" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"stripe_invoice_id" text,
	"hosted_invoice_url" text,
	"pdf_url" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" "resource_scope" DEFAULT 'account' NOT NULL,
	"transport" "mcp_transport" DEFAULT 'stdio' NOT NULL,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"headers" jsonb,
	"env" jsonb,
	"secrets_ciphertext" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"status" "connection_status" DEFAULT 'disconnected' NOT NULL,
	"status_message" text,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_approval" boolean DEFAULT true NOT NULL,
	"last_connected_at" timestamp with time zone,
	"last_health_check_at" timestamp with time zone,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"input_schema" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_destructive" boolean DEFAULT false NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"kind" text DEFAULT 'file' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"inline_content" text,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text,
	"role" "message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"thinking" text,
	"status" "message_status" DEFAULT 'complete' NOT NULL,
	"model_id" text,
	"agent_mode" "agent_mode",
	"sequence" integer DEFAULT 0 NOT NULL,
	"parent_message_id" text,
	"edited_at" timestamp with time zone,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"upstream_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"time_to_first_token_ms" integer,
	"finish_reason" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"input_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"output_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"cached_input_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"cache_write_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'catalog' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"family" text DEFAULT 'other' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"context_window" integer DEFAULT 128000 NOT NULL,
	"max_output_tokens" integer DEFAULT 8192 NOT NULL,
	"supports_tools" boolean DEFAULT true NOT NULL,
	"supports_vision" boolean DEFAULT false NOT NULL,
	"supports_caching" boolean DEFAULT false NOT NULL,
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"min_plan_tier" "plan_tier" DEFAULT 'payg' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"admin_override" jsonb,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text,
	"level" "notification_level" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"action_label" text,
	"action_href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payg_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"balance_micro_usd" bigint DEFAULT 0 NOT NULL,
	"lifetime_topped_up_micro_usd" bigint DEFAULT 0 NOT NULL,
	"lifetime_spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"credit_limit_micro_usd" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_micro_usd_monthly" bigint DEFAULT 0 NOT NULL,
	"price_micro_usd_yearly" bigint DEFAULT 0 NOT NULL,
	"stripe_price_id_monthly" text,
	"stripe_price_id_yearly" text,
	"included_weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"included_compute_hours" real DEFAULT 0 NOT NULL,
	"max_active_sandboxes" integer DEFAULT 1 NOT NULL,
	"max_sandbox_memory_mb" integer DEFAULT 512 NOT NULL,
	"max_sandbox_cpu_cores" real DEFAULT 0.25 NOT NULL,
	"storage_gb" integer DEFAULT 5 NOT NULL,
	"max_team_members" integer DEFAULT 1 NOT NULL,
	"max_projects" integer DEFAULT 10 NOT NULL,
	"max_skills" integer DEFAULT 5 NOT NULL,
	"max_plugins" integer DEFAULT 5 NOT NULL,
	"max_mcp_servers" integer DEFAULT 3 NOT NULL,
	"max_concurrent_runs" integer DEFAULT 1 NOT NULL,
	"queue_priority" integer DEFAULT 0 NOT NULL,
	"audit_retention_days" integer DEFAULT 7 NOT NULL,
	"auto_sleep_minutes" integer DEFAULT 15 NOT NULL,
	"auto_destroy_hours" integer DEFAULT 72 NOT NULL,
	"allow_byok" boolean DEFAULT false NOT NULL,
	"allow_docker" boolean DEFAULT false NOT NULL,
	"allow_own_server" boolean DEFAULT true NOT NULL,
	"allow_external_sandbox" boolean DEFAULT false NOT NULL,
	"allow_custom_sandbox_size" boolean DEFAULT false NOT NULL,
	"allow_preview_deployments" boolean DEFAULT false NOT NULL,
	"allow_private_skills" boolean DEFAULT false NOT NULL,
	"allow_api_access" boolean DEFAULT false NOT NULL,
	"allow_sso" boolean DEFAULT false NOT NULL,
	"allow_dedicated_worker" boolean DEFAULT false NOT NULL,
	"allow_custom_model_routing" boolean DEFAULT false NOT NULL,
	"allowed_shells" jsonb DEFAULT '["bash"]'::jsonb NOT NULL,
	"support_level" text DEFAULT 'community' NOT NULL,
	"margin_bps" integer DEFAULT 2000 NOT NULL,
	"overage_micro_usd_per_m_weighted" bigint DEFAULT 0 NOT NULL,
	"overage_micro_usd_per_compute_hour" bigint DEFAULT 0 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"highlight" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"publisher" text DEFAULT 'Karo' NOT NULL,
	"category" "plugin_category" DEFAULT 'development' NOT NULL,
	"icon" text DEFAULT 'package' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provided_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provided_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_plan_tier" "plan_tier" DEFAULT 'payg' NOT NULL,
	"requires_privileged" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"homepage_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_directory" boolean DEFAULT false NOT NULL,
	"is_binary" boolean DEFAULT false NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"language" text,
	"pending_content" text,
	"pending_change_kind" "file_change_kind",
	"pending_by_run_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template" text DEFAULT 'blank' NOT NULL,
	"runtime_target" "runtime_target" DEFAULT 'karo_cloud' NOT NULL,
	"worker_id" text,
	"default_model_id" text,
	"default_agent_mode" "agent_mode" DEFAULT 'build' NOT NULL,
	"default_shell" "shell_kind" DEFAULT 'bash' NOT NULL,
	"permissions" jsonb,
	"git_remote_url" text,
	"git_branch" text DEFAULT 'main' NOT NULL,
	"env_vars" jsonb,
	"archived_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'model' NOT NULL,
	"base_url" text,
	"catalog_url" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"compute_multiplier" real DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"health_status" "connection_status" DEFAULT 'disconnected' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"team_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"created_by_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"external_id" text,
	"worker_id" text,
	"status" "sandbox_status" DEFAULT 'creating' NOT NULL,
	"status_message" text,
	"image" text DEFAULT 'karo/sandbox-base:1' NOT NULL,
	"region" text,
	"cpu_cores" real DEFAULT 0.25 NOT NULL,
	"memory_mb" integer DEFAULT 512 NOT NULL,
	"disk_gb" integer DEFAULT 5 NOT NULL,
	"compute_multiplier" real DEFAULT 1 NOT NULL,
	"cpu_percent" real DEFAULT 0 NOT NULL,
	"memory_used_mb" integer DEFAULT 0 NOT NULL,
	"disk_used_mb" integer DEFAULT 0 NOT NULL,
	"process_count" integer DEFAULT 0 NOT NULL,
	"auto_sleep_minutes" integer DEFAULT 15 NOT NULL,
	"auto_destroy_hours" integer DEFAULT 72 NOT NULL,
	"network_policy" text DEFAULT 'restricted' NOT NULL,
	"allow_docker" boolean DEFAULT false NOT NULL,
	"total_active_seconds" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"author" text DEFAULT 'Karo' NOT NULL,
	"icon" text DEFAULT 'sparkles' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_plugins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slash_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'official' NOT NULL,
	"owner_team_id" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"quota_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "team_role" DEFAULT 'developer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" text NOT NULL,
	"is_personal" boolean DEFAULT true NOT NULL,
	"avatar_color" text DEFAULT 'primary' NOT NULL,
	"stripe_customer_id" text,
	"spend_cap_micro_usd" bigint DEFAULT 0 NOT NULL,
	"usage_alert_threshold" real DEFAULT 0.8 NOT NULL,
	"auto_topup_enabled" boolean DEFAULT false NOT NULL,
	"auto_topup_threshold_micro_usd" bigint DEFAULT 0 NOT NULL,
	"auto_topup_amount_micro_usd" bigint DEFAULT 0 NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'Terminal' NOT NULL,
	"shell" "shell_kind" DEFAULT 'bash' NOT NULL,
	"cwd" text DEFAULT '/workspace' NOT NULL,
	"cols" integer DEFAULT 80 NOT NULL,
	"rows" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"scrollback" text DEFAULT '' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exit_code" integer,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"message_id" text,
	"external_call_id" text,
	"tool_name" text NOT NULL,
	"source" text DEFAULT 'builtin' NOT NULL,
	"source_ref" text,
	"args" jsonb,
	"result" text,
	"result_summary" text,
	"status" "tool_call_status" DEFAULT 'pending' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"is_error" boolean DEFAULT false NOT NULL,
	"exit_code" integer,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topups" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text,
	"amount_micro_usd" bigint DEFAULT 0 NOT NULL,
	"bonus_micro_usd" bigint DEFAULT 0 NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_checkout_session_id" text,
	"idempotency_key" text,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"conversation_id" text,
	"message_id" text,
	"run_id" text,
	"kind" "usage_kind" DEFAULT 'model' NOT NULL,
	"provider_key" text DEFAULT 'mock' NOT NULL,
	"model_id" text,
	"model_slug" text DEFAULT '' NOT NULL,
	"model_price_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"weighted_tokens" bigint DEFAULT 0 NOT NULL,
	"output_multiplier" real DEFAULT 1 NOT NULL,
	"upstream_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"gross_margin_micro_usd" bigint DEFAULT 0 NOT NULL,
	"settlement" text DEFAULT 'quota' NOT NULL,
	"used_byok" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"error_code" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"weighted_tokens_used" bigint DEFAULT 0 NOT NULL,
	"compute_hours_used" real DEFAULT 0 NOT NULL,
	"storage_gb_used" real DEFAULT 0 NOT NULL,
	"model_charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"compute_charged_micro_usd" bigint DEFAULT 0 NOT NULL,
	"overage_micro_usd" bigint DEFAULT 0 NOT NULL,
	"upstream_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"alert_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text,
	"label" text NOT NULL,
	"provider_key" text NOT NULL,
	"base_url" text,
	"key_ciphertext" text NOT NULL,
	"key_last4" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_verify_error" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"name" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"password_hash" text,
	"platform_role" "platform_role" DEFAULT 'user' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"onboarding_state" jsonb,
	"last_seen_at" timestamp with time zone,
	"default_team_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byos_workers" ADD CONSTRAINT "byos_workers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byos_workers" ADD CONSTRAINT "byos_workers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_events" ADD CONSTRAINT "compute_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_events" ADD CONSTRAINT "compute_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_events" ADD CONSTRAINT "compute_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_events" ADD CONSTRAINT "compute_events_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD CONSTRAINT "custom_commands_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_commands" ADD CONSTRAINT "custom_commands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_plugins" ADD CONSTRAINT "installed_plugins_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_plugins" ADD CONSTRAINT "installed_plugins_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_plugins" ADD CONSTRAINT "installed_plugins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_plugins" ADD CONSTRAINT "installed_plugins_installed_by_id_users_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_skills" ADD CONSTRAINT "installed_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_skills" ADD CONSTRAINT "installed_skills_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_skills" ADD CONSTRAINT "installed_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_skills" ADD CONSTRAINT "installed_skills_installed_by_id_users_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payg_balances" ADD CONSTRAINT "payg_balances_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_sessions" ADD CONSTRAINT "sandbox_sessions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_sessions" ADD CONSTRAINT "sandbox_sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topups" ADD CONSTRAINT "topups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topups" ADD CONSTRAINT "topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_periods" ADD CONSTRAINT "usage_periods_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_unique" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_settings_category_idx" ON "admin_settings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_idx" ON "agent_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_runs_team_idx" ON "agent_runs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_team_time_idx" ON "audit_events" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_time_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "byos_workers_install_token_unique" ON "byos_workers" USING btree ("install_token_hash");--> statement-breakpoint
CREATE INDEX "byos_workers_team_idx" ON "byos_workers" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "compute_events_team_time_idx" ON "compute_events" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "compute_events_sandbox_idx" ON "compute_events" USING btree ("sandbox_id","occurred_at");--> statement-breakpoint
CREATE INDEX "compute_events_project_idx" ON "compute_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_commands_scope_name_unique" ON "custom_commands" USING btree ("team_id","project_id","name");--> statement-breakpoint
CREATE INDEX "custom_commands_team_idx" ON "custom_commands" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_hash_unique" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_tokens_user_kind_idx" ON "email_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_unique" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "installed_plugins_team_idx" ON "installed_plugins" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installed_plugins_unique" ON "installed_plugins" USING btree ("team_id","plugin_id","project_id");--> statement-breakpoint
CREATE INDEX "installed_skills_team_idx" ON "installed_skills" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installed_skills_unique" ON "installed_skills" USING btree ("team_id","skill_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_team_idx" ON "invitations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_team_idx" ON "invoices" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_stripe_unique" ON "invoices" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_team_idx" ON "mcp_servers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_project_idx" ON "mcp_servers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_team_name_unique" ON "mcp_servers" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tools_server_name_unique" ON "mcp_tools" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "messages_run_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "model_prices_model_idx" ON "model_prices" USING btree ("model_id","effective_from");--> statement-breakpoint
CREATE INDEX "model_prices_current_idx" ON "model_prices" USING btree ("model_id","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_slug_unique" ON "models" USING btree ("provider_id","slug");--> statement-breakpoint
CREATE INDEX "models_enabled_idx" ON "models" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "models_family_idx" ON "models" USING btree ("family");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payg_balances_team_unique" ON "payg_balances" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_unique" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE INDEX "plans_tier_idx" ON "plans" USING btree ("tier");--> statement-breakpoint
CREATE UNIQUE INDEX "plugins_key_unique" ON "plugins" USING btree ("key");--> statement-breakpoint
CREATE INDEX "plugins_category_idx" ON "plugins" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_path_unique" ON "project_files" USING btree ("project_id","path");--> statement-breakpoint
CREATE INDEX "project_files_project_idx" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_files_pending_idx" ON "project_files" USING btree ("project_id","pending_change_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_slug_unique" ON "projects" USING btree ("team_id","slug");--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "projects" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_key_unique" ON "providers" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sandbox_sessions_sandbox_idx" ON "sandbox_sessions" USING btree ("sandbox_id","started_at");--> statement-breakpoint
CREATE INDEX "sandbox_sessions_team_idx" ON "sandbox_sessions" USING btree ("team_id","started_at");--> statement-breakpoint
CREATE INDEX "sandboxes_team_status_idx" ON "sandboxes" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "sandboxes_project_idx" ON "sandboxes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sandboxes_provider_external_idx" ON "sandboxes" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_key_unique" ON "skills" USING btree ("key");--> statement-breakpoint
CREATE INDEX "skills_owner_idx" ON "skills" USING btree ("owner_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_team_unique" ON "subscriptions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_unique" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_unique" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_unique" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "teams_owner_idx" ON "teams" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "teams_stripe_customer_idx" ON "teams" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "terminal_sessions_sandbox_idx" ON "terminal_sessions" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "terminal_sessions_user_idx" ON "terminal_sessions" USING btree ("user_id","last_active_at");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "tool_calls_message_idx" ON "tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "tool_calls_status_idx" ON "tool_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "topups_team_idx" ON "topups" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topups_idempotency_unique" ON "topups" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_events_team_time_idx" ON "usage_events" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_project_time_idx" ON "usage_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_model_time_idx" ON "usage_events" USING btree ("model_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_time_idx" ON "usage_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_kind_idx" ON "usage_events" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_periods_team_period_unique" ON "usage_periods" USING btree ("team_id","period_start");--> statement-breakpoint
CREATE INDEX "usage_periods_team_idx" ON "usage_periods" USING btree ("team_id","period_start");--> statement-breakpoint
CREATE INDEX "user_api_keys_user_idx" ON "user_api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_api_keys_fingerprint_unique" ON "user_api_keys" USING btree ("user_id","key_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_platform_role_idx" ON "users" USING btree ("platform_role");