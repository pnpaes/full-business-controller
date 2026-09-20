CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_count_status_check" CHECK ("stock_count"."status" in ('draft', 'counting', 'submitted', 'approved', 'cancelled')),
	CONSTRAINT "stock_count_approved_check" CHECK ("stock_count"."status" <> 'approved' or ("stock_count"."approved_by" is not null and "stock_count"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"storage_area_id" uuid NOT NULL,
	"lot_id" uuid,
	"expected_qty" numeric(19, 6) NOT NULL,
	"counted_qty" numeric(19, 6),
	"variance_qty" numeric(19, 6),
	"reason_code" text,
	"recount" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stock_count_line_key" UNIQUE NULLS NOT DISTINCT("stock_count_id","item_id","storage_area_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"from_storage_area_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"to_storage_area_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"dispatch_movement_id" uuid,
	"receipt_movement_id" uuid,
	"discrepancy_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_transfer_status_check" CHECK ("stock_transfer"."status" in ('draft', 'requested', 'approved', 'dispatched', 'received', 'cancelled')),
	CONSTRAINT "stock_transfer_dispatched_check" CHECK ("stock_transfer"."status" not in ('dispatched', 'received') or "stock_transfer"."dispatched_at" is not null),
	CONSTRAINT "stock_transfer_received_check" CHECK ("stock_transfer"."status" <> 'received' or ("stock_transfer"."dispatched_at" is not null and "stock_transfer"."received_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "waste_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_area_id" uuid NOT NULL,
	"item_id" uuid,
	"product_variant_id" uuid,
	"production_batch_id" uuid,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"reason_code" text NOT NULL,
	"value_method" text NOT NULL,
	"value" numeric(19, 4),
	"currency" char(3),
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"photo_file_id" uuid,
	"corrective_action" text,
	"snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "waste_event_stage_check" CHECK ("waste_event"."stage" in ('receiving', 'storage_expiry', 'preparation', 'production', 'display', 'unsold_finished_goods', 'customer_return', 'count_discovered', 'other')),
	CONSTRAINT "waste_event_value_method_check" CHECK ("waste_event"."value_method" in ('cost_selection', 'moving_average', 'latest_price', 'manual')),
	CONSTRAINT "waste_event_item_or_variant_check" CHECK ("waste_event"."item_id" is not null or "waste_event"."product_variant_id" is not null),
	CONSTRAINT "waste_event_quantity_check" CHECK ("waste_event"."quantity" > 0),
	CONSTRAINT "waste_event_value_check" CHECK ("waste_event"."value" is null or "waste_event"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movement" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_stock_count_id_stock_count_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_count"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_location_id_location_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_storage_area_id_storage_area_id_fk" FOREIGN KEY ("from_storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_location_id_location_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_storage_area_id_storage_area_id_fk" FOREIGN KEY ("to_storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_dispatch_movement_id_stock_movement_id_fk" FOREIGN KEY ("dispatch_movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_receipt_movement_id_stock_movement_id_fk" FOREIGN KEY ("receipt_movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_event" ADD CONSTRAINT "waste_event_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_count_org_location_cutoff_idx" ON "stock_count" USING btree ("organization_id","location_id","cutoff");--> statement-breakpoint
CREATE INDEX "stock_count_org_status_idx" ON "stock_count" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "stock_count_line_count_idx" ON "stock_count_line" USING btree ("stock_count_id");--> statement-breakpoint
CREATE INDEX "stock_count_line_item_idx" ON "stock_count_line" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stock_count_line_storage_area_idx" ON "stock_count_line" USING btree ("storage_area_id");--> statement-breakpoint
CREATE INDEX "stock_count_line_lot_idx" ON "stock_count_line" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_org_status_idx" ON "stock_transfer" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfer_from_location_idx" ON "stock_transfer" USING btree ("organization_id","from_location_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_to_location_idx" ON "stock_transfer" USING btree ("organization_id","to_location_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_from_storage_area_idx" ON "stock_transfer" USING btree ("organization_id","from_storage_area_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_to_storage_area_idx" ON "stock_transfer" USING btree ("organization_id","to_storage_area_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_dispatch_movement_idx" ON "stock_transfer" USING btree ("dispatch_movement_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_receipt_movement_idx" ON "stock_transfer" USING btree ("receipt_movement_id");--> statement-breakpoint
CREATE INDEX "waste_event_org_location_occurred_idx" ON "waste_event" USING btree ("organization_id","location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "waste_event_item_idx" ON "waste_event" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "waste_event_product_variant_idx" ON "waste_event" USING btree ("product_variant_id");--> statement-breakpoint
CREATE INDEX "waste_event_storage_area_idx" ON "waste_event" USING btree ("storage_area_id");--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_transfer_id_stock_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movement_transfer_idx" ON "stock_movement" USING btree ("transfer_id") WHERE "stock_movement"."transfer_id" is not null;
--> statement-breakpoint
-- Hand-written invariants (mirrors 0002 / 0005 / 0007 / 0010 / 0012 / 0016 / 0017).
-- Slice-9 counts + transfers + waste (INV-004..007, INV-009, WASTE-001/002) under
-- DEC-017, DEC-018 and DEC-029.
--
-- `0017_stock_ledger_invariants.sql` created `stock_movement_source_guard` as a
-- goods_receipt-only no-op for every other `source_type`, with the explicit note
-- that each slice extends the same trigger as its source table lands. This
-- replaces the function body so `source_type` in ('stock_count', 'transfer',
-- 'waste_event') is now validated against the matching slice-9 table (existence
-- plus the same `organization_id`), keeping the existing goods_receipt branch and
-- leaving the remaining source types (`production_batch`, `sales_line`,
-- `adjustment`, `revaluation`, `correction`) as documented no-ops until their
-- slices land. `CREATE OR REPLACE FUNCTION` keeps the existing BEFORE INSERT
-- trigger pointing at the new body, so no trigger is recreated.
--
-- The status-consistency checks are expressed by drizzle-kit in the generated
-- `CREATE TABLE` statements above:
--   * `stock_count_approved_check`   — an approved count records approved_by/at.
--   * `stock_transfer_dispatched_check` / `stock_transfer_received_check` — a
--     dispatched/received transfer records its dispatch (and receipt) timestamps.
--
-- `stock_movement` is append-only (0002_invariants.sql rejects UPDATE/DELETE/
-- TRUNCATE), so a BEFORE INSERT guard is sufficient.
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
  END IF;

  -- All other source_types are a deliberate no-op until their slice lands.
  RETURN NEW;
END;
$$;
