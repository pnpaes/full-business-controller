-- `ADR-0010` (accepted 2026-09-27) / `DEC-143` (`DEC-149` row 18a, `COMP-001`):
-- competitor sources. Expand-only: one new table plus nullable additions to the
-- existing `competitor_observation` (the `DEC-126` columns, the flat
-- `source`/`source_url`/`review_status`, are deliberately untouched — the §4C
-- `review_state` IS `review_status`, so no second state column is added).
--
-- Two structural invariants live in checks: `collection_mode = 'automated'`
-- requires `terms_status = 'approved'` (automation is enabled only after the
-- source's terms are approved), and any non-`pending` terms decision records
-- both `approved_by` and `approved_at` (no silent decision). `approved_by` and
-- the deferred `competitor_id` link are plain uuids, not FKs.
--
-- The down companion `0076_competitor_source_down.sql` is hand-written
-- (drizzle-kit cannot express a hand-ordered column drop) and is not journaled:
-- `drizzle-kit migrate` applies journal entries only, so a rollback is an
-- explicit operator action (docs/runbooks/persistence-migrations.md).
CREATE TABLE "competitor_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"competitor_name" text NOT NULL,
	"competitor_id" uuid,
	"source_type" text NOT NULL,
	"url_or_identifier" text NOT NULL,
	"collection_mode" text NOT NULL,
	"terms_status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rate_limit_note" text,
	"active_from" date NOT NULL,
	"active_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "competitor_source_organization_id_url_key" UNIQUE("organization_id","url_or_identifier"),
	CONSTRAINT "competitor_source_source_type_check" CHECK ("competitor_source"."source_type" in ('website', 'wolt', 'instagram_manual', 'other')),
	CONSTRAINT "competitor_source_collection_mode_check" CHECK ("competitor_source"."collection_mode" in ('automated', 'manual')),
	CONSTRAINT "competitor_source_terms_status_check" CHECK ("competitor_source"."terms_status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "competitor_source_name_check" CHECK (length(btrim("competitor_source"."competitor_name")) > 0),
	CONSTRAINT "competitor_source_url_check" CHECK (length(btrim("competitor_source"."url_or_identifier")) > 0),
	CONSTRAINT "competitor_source_automation_requires_approval_check" CHECK ("competitor_source"."collection_mode" <> 'automated' or "competitor_source"."terms_status" = 'approved'),
	CONSTRAINT "competitor_source_terms_decision_check" CHECK ("competitor_source"."terms_status" = 'pending' or ("competitor_source"."approved_by" is not null and "competitor_source"."approved_at" is not null)),
	CONSTRAINT "competitor_source_active_range_check" CHECK ("competitor_source"."active_to" is null or "competitor_source"."active_to" > "competitor_source"."active_from")
);
--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD COLUMN "competitor_source_id" uuid;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD COLUMN "product_category" text;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_source" ADD CONSTRAINT "competitor_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_source_org_idx" ON "competitor_source" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD CONSTRAINT "competitor_observation_competitor_source_id_competitor_source_id_fk" FOREIGN KEY ("competitor_source_id") REFERENCES "public"."competitor_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_observation_source_idx" ON "competitor_observation" USING btree ("competitor_source_id");--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD CONSTRAINT "competitor_observation_capture_method_check" CHECK ("competitor_observation"."capture_method" is null or "competitor_observation"."capture_method" in ('automated', 'manual'));