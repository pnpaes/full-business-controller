-- `ADR-0009` / `DEC-142` (row 17, `FCST-004`): the AI-advisory review
-- foundation. Expand-only: two new tables, no existing table touched.
--
-- Deliberate deviation from `DATA_DICTIONARY` §4B: the dictionary omits
-- `organization_id` on `ai_suggestion`, but it is added here because the
-- repository's tenancy convention (`DEC-061`) puts `organization_id` on every
-- business table — a suggestion is reachable directly by id at the review route
-- (`POST /api/v1/ai/suggestions/[id]/approve|reject`), so the org column is what
-- makes the read/write org-scoped and gives a cross-tenant id an
-- indistinguishable miss. It is the run's organization (the store writes the
-- run's value).
--
-- The append-only trigger at the end is hand-written (drizzle-kit cannot express
-- triggers); the down companion `0075_ai_advisory_down.sql` drops it and the two
-- tables. Like the other down files it is not journaled.
CREATE TABLE "ai_analysis_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_estimate" numeric(19, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_analysis_run_kind_check" CHECK ("ai_analysis_run"."kind" in ('forecast', 'menu', 'seasonal', 'other')),
	CONSTRAINT "ai_analysis_run_status_check" CHECK ("ai_analysis_run"."status" in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_analysis_run_provider_check" CHECK (length(btrim("ai_analysis_run"."provider")) > 0),
	CONSTRAINT "ai_analysis_run_model_check" CHECK (length(btrim("ai_analysis_run"."model")) > 0),
	CONSTRAINT "ai_analysis_run_prompt_version_check" CHECK (length(btrim("ai_analysis_run"."prompt_version")) > 0),
	CONSTRAINT "ai_analysis_run_cost_check" CHECK ("ai_analysis_run"."cost_estimate" is null or "ai_analysis_run"."cost_estimate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_ref" uuid,
	"suggestion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_suggestion_state_check" CHECK ("ai_suggestion"."state" in ('proposed', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "ai_suggestion_scope_type_check" CHECK (length(btrim("ai_suggestion"."scope_type")) > 0),
	CONSTRAINT "ai_suggestion_reason_check" CHECK ("ai_suggestion"."state" not in ('rejected', 'superseded') or ("ai_suggestion"."reason" is not null and length(btrim("ai_suggestion"."reason")) > 0)),
	CONSTRAINT "ai_suggestion_decided_check" CHECK ("ai_suggestion"."state" = 'proposed' or ("ai_suggestion"."decided_by" is not null and "ai_suggestion"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai_analysis_run" ADD CONSTRAINT "ai_analysis_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_analysis_run_id_ai_analysis_run_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."ai_analysis_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestion_analysis_run_idx" ON "ai_suggestion" USING btree ("analysis_run_id");--> statement-breakpoint
-- Hand-written (drizzle-kit cannot express triggers): `ai_analysis_run`
-- provenance is a recorded fact (`ADR-0009`), so it is append-only — a
-- correction is a new run, never an edit or a delete. Reuses the shared
-- `reject_immutable_change()` from `0002_invariants.sql` (the
-- `calculation_snapshot`/`audit_event` precedent). `ai_suggestion` is
-- deliberately NOT immutable: its state machine mutates
-- `state`/`decided_by`/`decided_at`/`reason`. Forward-only; the down companion
-- drops both triggers.
CREATE TRIGGER "ai_analysis_run_immutable"
  BEFORE UPDATE OR DELETE ON "ai_analysis_run"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "ai_analysis_run_no_truncate"
  BEFORE TRUNCATE ON "ai_analysis_run"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_immutable_change"();