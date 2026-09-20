CREATE TABLE "reconciliation_tolerance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"floor_amount" numeric(19, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reconciliation_tolerance_kind_check" CHECK ("reconciliation_tolerance"."kind" in ('sales_settlement', 'supplier_invoice')),
	CONSTRAINT "reconciliation_tolerance_rate_check" CHECK ("reconciliation_tolerance"."rate" >= 0),
	CONSTRAINT "reconciliation_tolerance_floor_check" CHECK ("reconciliation_tolerance"."floor_amount" >= 0),
	CONSTRAINT "reconciliation_tolerance_effective_range_check" CHECK ("reconciliation_tolerance"."effective_to" is null or "reconciliation_tolerance"."effective_to" > "reconciliation_tolerance"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_tolerance" ADD CONSTRAINT "reconciliation_tolerance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_tolerance_org_kind_idx" ON "reconciliation_tolerance" USING btree ("organization_id","kind");--> statement-breakpoint
-- Hand-written invariants (mirrors 0002 / 0005 / 0010 / 0012 / 0016 / 0017 /
-- 0020 / 0021 / 0023).
-- DEC-072: the effective-dated FIN-owned tolerance configuration is keyed
-- (organization_id, kind) with a non-overlapping [effective_from, effective_to)
-- window, exactly like the slice-6 cost-allocation exclusions (0012). One
-- tolerance applies to a (organization, kind) at any instant, so overlapping
-- version rows are rejected -- the FND-004 rule drizzle-kit cannot express.
-- Emitted here rather than in the generated CREATE TABLE because drizzle-kit has
-- no representation for `EXCLUDE USING gist`: the columns stay plain
-- `uuid`/`text`/`date` in the TypeScript schema, so `generate` never sees or
-- fights this constraint (hand-written invariants convention).
--
-- `btree_gist` is already enabled in `0000_enable_extensions.sql`; the `=`
-- operators on `uuid`/`text` in an EXCLUDE constraint require it.
ALTER TABLE "reconciliation_tolerance" ADD CONSTRAINT "reconciliation_tolerance_no_overlap"
  EXCLUDE USING gist ("organization_id" WITH =, "kind" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);