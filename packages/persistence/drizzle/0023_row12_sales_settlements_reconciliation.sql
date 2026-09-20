CREATE TABLE "reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"expected_amount" numeric(19, 4) NOT NULL,
	"actual_amount" numeric(19, 4) NOT NULL,
	"tolerance" numeric(19, 4) NOT NULL,
	"difference" numeric(19, 4) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_note" text,
	"owner_id" uuid,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reconciliation_status_check" CHECK ("reconciliation"."status" in ('pending', 'within_tolerance', 'exception', 'resolved', 'approved')),
	CONSTRAINT "reconciliation_period_check" CHECK ("reconciliation"."period_end" >= "reconciliation"."period_start")
);
--> statement-breakpoint
CREATE TABLE "sales_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sales_transaction_id" uuid NOT NULL,
	"product_variant_id" uuid,
	"external_product_ref" text,
	"sku" text,
	"external_line_id" text,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_price" numeric(19, 4),
	"gross_amount" numeric(19, 4),
	"net_amount" numeric(19, 4),
	"tax_amount" numeric(19, 4),
	"applied_tax_rate" numeric(9, 6),
	"discount_amount" numeric(19, 4),
	"refund_amount" numeric(19, 4),
	"channel_id" uuid,
	"tax_rule_id" uuid,
	"parent_line_id" uuid,
	"option_kind" text DEFAULT 'standalone' NOT NULL,
	"channel_fee_basis" text,
	"mapping_state" text DEFAULT 'unmapped' NOT NULL,
	"reversal_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sales_line_transaction_line_key" UNIQUE("sales_transaction_id","external_line_id"),
	CONSTRAINT "sales_line_option_kind_check" CHECK ("sales_line"."option_kind" in ('standalone', 'attached', 'included')),
	CONSTRAINT "sales_line_mapping_state_check" CHECK ("sales_line"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error')),
	CONSTRAINT "sales_line_applied_tax_rate_check" CHECK ("sales_line"."applied_tax_rate" is null or "sales_line"."applied_tax_rate" >= 0),
	CONSTRAINT "sales_line_option_parent_check" CHECK ("sales_line"."option_kind" = 'standalone' or "sales_line"."parent_line_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"source_system" text NOT NULL,
	"external_transaction_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"gross_amount" numeric(19, 4),
	"net_amount" numeric(19, 4),
	"tax_amount" numeric(19, 4),
	"discount_amount" numeric(19, 4),
	"refund_amount" numeric(19, 4),
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sales_transaction_external_key" UNIQUE("source_system","external_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"channel_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"paid_amount" numeric(19, 4),
	"fee_amount" numeric(19, 4),
	"refund_amount" numeric(19, 4),
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"source_file_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "settlement_period_check" CHECK ("settlement"."period_end" >= "settlement"."period_start")
);
--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_sales_transaction_id_sales_transaction_id_fk" FOREIGN KEY ("sales_transaction_id") REFERENCES "public"."sales_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_tax_rule_id_tax_rule_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "public"."tax_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_parent_line_id_sales_line_id_fk" FOREIGN KEY ("parent_line_id") REFERENCES "public"."sales_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_reversal_of_id_sales_line_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."sales_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_org_status_idx" ON "reconciliation" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "reconciliation_org_scope_idx" ON "reconciliation" USING btree ("organization_id","scope_type","scope_id","period_start");--> statement-breakpoint
CREATE INDEX "sales_line_transaction_idx" ON "sales_line" USING btree ("sales_transaction_id");--> statement-breakpoint
CREATE INDEX "sales_line_sku_idx" ON "sales_line" USING btree ("organization_id","sku");--> statement-breakpoint
CREATE INDEX "sales_transaction_org_occurred_idx" ON "sales_transaction" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "settlement_org_provider_period_idx" ON "settlement" USING btree ("organization_id","provider","period_start");
--> statement-breakpoint
-- Hand-written invariants (mirrors 0002 / 0005 / 0007 / 0010 / 0012 / 0016 /
-- 0017 / 0020 / 0021).
-- Slice 12 sales + settlements + reconciliation (SALE-001..011, PRICE-006,
-- REC-001/002/005; DEC-026, DEC-035, DEC-042, DEC-043, DEC-045; ADR-0008
-- accepted 2026-09-20).
--
-- `0017_stock_ledger_invariants.sql` created `stock_movement_source_guard` with
-- the explicit note that each slice extends the same trigger as its source table
-- lands; `0020` added the `stock_count`/`transfer`/`waste_event` branches and
-- `0021` added `production_batch`. This replaces the function body once more so
-- `source_type = 'sales_line'` is validated against `sales_line` (existence plus
-- the same `organization_id`), keeping every existing branch.
-- `CREATE OR REPLACE FUNCTION` keeps the existing BEFORE INSERT trigger pointing
-- at the new body, so no trigger is recreated. The remaining source types
-- (`adjustment`, `revaluation`, `correction`) stay documented no-ops until their
-- slices land.
--
-- `sales_line` is not append-only, so the line reference can be deleted after a
-- movement points at it; the guard only validates at insert time, like the other
-- source branches.
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
  ELSIF NEW."source_type" = 'sales_line' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "sales_line"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a sales_line in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- All other source_types are a deliberate no-op until their slice lands.
  RETURN NEW;
END;
$$;