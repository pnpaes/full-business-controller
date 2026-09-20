CREATE TABLE "production_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"workstation" text,
	"recipe_version_id" uuid NOT NULL,
	"plan_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_start" timestamp with time zone,
	"actual_start" timestamp with time zone,
	"actual_finish" timestamp with time zone,
	"operator_id" uuid,
	"destination_storage_area_id" uuid,
	"planned_output_qty" numeric(19, 6),
	"actual_output_qty" numeric(19, 6),
	"yield_variance_pct" numeric(9, 6),
	"reversal_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "production_batch_status_check" CHECK ("production_batch"."status" in ('planned', 'released', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "production_batch_planned_output_qty_check" CHECK ("production_batch"."planned_output_qty" is null or "production_batch"."planned_output_qty" >= 0),
	CONSTRAINT "production_batch_actual_output_qty_check" CHECK ("production_batch"."actual_output_qty" is null or "production_batch"."actual_output_qty" >= 0),
	CONSTRAINT "production_batch_actual_range_check" CHECK ("production_batch"."actual_finish" is null or "production_batch"."actual_start" is null or "production_batch"."actual_finish" >= "production_batch"."actual_start")
);
--> statement-breakpoint
CREATE TABLE "production_batch_input" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"planned_qty" numeric(19, 6) NOT NULL,
	"actual_qty" numeric(19, 6),
	"variance_qty" numeric(19, 6),
	"lot_id" uuid,
	"reason_code" text,
	"movement_id" uuid,
	CONSTRAINT "production_batch_input_planned_qty_check" CHECK ("production_batch_input"."planned_qty" >= 0),
	CONSTRAINT "production_batch_input_actual_qty_check" CHECK ("production_batch_input"."actual_qty" is null or "production_batch_input"."actual_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_batch_output" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"planned_qty" numeric(19, 6) NOT NULL,
	"actual_qty" numeric(19, 6),
	"variance_qty" numeric(19, 6),
	"lot_id" uuid,
	"expiry_date" date,
	"movement_id" uuid,
	CONSTRAINT "production_batch_output_kind_check" CHECK ("production_batch_output"."kind" in ('finished', 'intermediate', 'by_product', 'waste')),
	CONSTRAINT "production_batch_output_planned_qty_check" CHECK ("production_batch_output"."planned_qty" >= 0),
	CONSTRAINT "production_batch_output_actual_qty_check" CHECK ("production_batch_output"."actual_qty" is null or "production_batch_output"."actual_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"production_date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_plan_id_production_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_destination_storage_area_id_storage_area_id_fk" FOREIGN KEY ("destination_storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_reversal_of_id_production_batch_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."production_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_input" ADD CONSTRAINT "production_batch_input_production_batch_id_production_batch_id_fk" FOREIGN KEY ("production_batch_id") REFERENCES "public"."production_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_input" ADD CONSTRAINT "production_batch_input_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_input" ADD CONSTRAINT "production_batch_input_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_input" ADD CONSTRAINT "production_batch_input_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_input" ADD CONSTRAINT "production_batch_input_movement_id_stock_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_output" ADD CONSTRAINT "production_batch_output_production_batch_id_production_batch_id_fk" FOREIGN KEY ("production_batch_id") REFERENCES "public"."production_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_output" ADD CONSTRAINT "production_batch_output_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_output" ADD CONSTRAINT "production_batch_output_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_output" ADD CONSTRAINT "production_batch_output_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batch_output" ADD CONSTRAINT "production_batch_output_movement_id_stock_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan" ADD CONSTRAINT "production_plan_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_batch_org_location_status_idx" ON "production_batch" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "production_batch_recipe_version_idx" ON "production_batch" USING btree ("recipe_version_id");--> statement-breakpoint
CREATE INDEX "production_batch_plan_idx" ON "production_batch" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "production_batch_operator_idx" ON "production_batch" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "production_batch_destination_storage_area_idx" ON "production_batch" USING btree ("destination_storage_area_id");--> statement-breakpoint
CREATE INDEX "production_batch_reversal_idx" ON "production_batch" USING btree ("reversal_of_id");--> statement-breakpoint
CREATE INDEX "production_batch_input_batch_idx" ON "production_batch_input" USING btree ("production_batch_id");--> statement-breakpoint
CREATE INDEX "production_batch_input_item_idx" ON "production_batch_input" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "production_batch_input_lot_idx" ON "production_batch_input" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "production_batch_input_movement_idx" ON "production_batch_input" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "production_batch_output_batch_idx" ON "production_batch_output" USING btree ("production_batch_id");--> statement-breakpoint
CREATE INDEX "production_batch_output_item_idx" ON "production_batch_output" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "production_batch_output_lot_idx" ON "production_batch_output" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "production_batch_output_movement_idx" ON "production_batch_output" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "production_plan_org_location_date_idx" ON "production_plan" USING btree ("organization_id","location_id","production_date");--> statement-breakpoint
CREATE INDEX "production_plan_org_status_idx" ON "production_plan" USING btree ("organization_id","status");
--> statement-breakpoint
-- Hand-written invariants (mirrors 0002 / 0005 / 0007 / 0010 / 0012 / 0016 / 0017 / 0020).
-- Slice-10 production planning + batches (PROD-001..005, DEC-031, DEC-034, DEC-036).
--
-- 1. The deferred `waste_event.production_batch_id` FK (`DATA_DICTIONARY` §7;
--    the column was added in `0020` as a plain uuid). Added `NOT VALID` then
--    `VALIDATE` per this runbook's deferred-FK pattern, because `waste_event`
--    may already hold rows at apply time: `NOT VALID` is metadata-only and
--    validates new writes, `VALIDATE CONSTRAINT` proceeds in the same
--    transactional migration if the table is clean.
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_production_batch_id_production_batch_id_fk" FOREIGN KEY ("production_batch_id") REFERENCES "public"."production_batch"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "waste_event" VALIDATE CONSTRAINT "waste_event_production_batch_id_production_batch_id_fk";--> statement-breakpoint
-- 2. `0017_stock_ledger_invariants.sql` created `stock_movement_source_guard`
--    with the explicit note that each slice extends the same trigger as its
--    source table lands; `0020` added the `stock_count`/`transfer`/`waste_event`
--    branches. This replaces the function body once more so
--    `source_type = 'production_batch'` is validated against `production_batch`
--    (existence plus the same `organization_id`), keeping the existing branches.
--    The remaining source types (`sales_line`, `adjustment`, `revaluation`,
--    `correction`) stay documented no-ops until their slices land.
--    `CREATE OR REPLACE FUNCTION` keeps the existing BEFORE INSERT trigger
--    pointing at the new body, so no trigger is recreated.
--
-- `production_batch` is not append-only, so the batch reference can be deleted
-- after a movement points at it; the guard only validates at insert time, like
-- the other source branches.
CREATE OR REPLACE FUNCTION "stock_movement_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_type" = 'goods_receipt' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "goods_receipt"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a goods_receipt in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'stock_count' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "stock_count"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a stock_count in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'transfer' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "stock_transfer"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a stock_transfer in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'waste_event' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "waste_event"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a waste_event in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'production_batch' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "production_batch"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a production_batch in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- All other source_types are a deliberate no-op until their slice lands.
  RETURN NEW;
END;
$$;