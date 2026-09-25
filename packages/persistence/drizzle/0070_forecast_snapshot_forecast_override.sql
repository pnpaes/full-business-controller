CREATE TABLE "forecast_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"metric" text NOT NULL,
	"grain" text NOT NULL,
	"period" text NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"category" text,
	"product_variant_id" uuid,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "forecast_override_metric_check" CHECK (length(btrim("forecast_override"."metric")) > 0),
	CONSTRAINT "forecast_override_grain_check" CHECK ("forecast_override"."grain" in ('day_location', 'day_location_category', 'day_location_product')),
	CONSTRAINT "forecast_override_grain_scope_check" CHECK (("forecast_override"."grain" <> 'day_location_category' or "forecast_override"."category" is not null) and ("forecast_override"."grain" <> 'day_location_product' or "forecast_override"."product_variant_id" is not null)),
	CONSTRAINT "forecast_override_period_check" CHECK (length(btrim("forecast_override"."period")) > 0),
	CONSTRAINT "forecast_override_reason_check" CHECK (length(btrim("forecast_override"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"grain" text NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"category" text,
	"product_variant_id" uuid,
	"as_of" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"projection" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accuracy_method" text,
	"accuracy_mape" numeric(9, 6),
	"accuracy_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "forecast_snapshot_org_scope_asof_key" UNIQUE NULLS NOT DISTINCT("organization_id","metric","grain","location_id","channel_id","category","product_variant_id","as_of"),
	CONSTRAINT "forecast_snapshot_metric_check" CHECK (length(btrim("forecast_snapshot"."metric")) > 0),
	CONSTRAINT "forecast_snapshot_grain_check" CHECK ("forecast_snapshot"."grain" in ('day_location', 'day_location_category', 'day_location_product')),
	CONSTRAINT "forecast_snapshot_grain_scope_check" CHECK (("forecast_snapshot"."grain" <> 'day_location_category' or "forecast_snapshot"."category" is not null) and ("forecast_snapshot"."grain" <> 'day_location_product' or "forecast_snapshot"."product_variant_id" is not null)),
	CONSTRAINT "forecast_snapshot_projection_check" CHECK (jsonb_typeof("forecast_snapshot"."projection") = 'array'),
	CONSTRAINT "forecast_snapshot_accuracy_check" CHECK (("forecast_snapshot"."accuracy_mape" is null or "forecast_snapshot"."accuracy_mape" >= 0) and ("forecast_snapshot"."accuracy_points" is null or "forecast_snapshot"."accuracy_points" >= 0))
);
--> statement-breakpoint
ALTER TABLE "forecast_override" ADD CONSTRAINT "forecast_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_override" ADD CONSTRAINT "forecast_override_snapshot_id_forecast_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."forecast_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_override" ADD CONSTRAINT "forecast_override_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_override" ADD CONSTRAINT "forecast_override_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_override" ADD CONSTRAINT "forecast_override_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_override_org_metric_grain_period_idx" ON "forecast_override" USING btree ("organization_id","metric","grain","period");--> statement-breakpoint
CREATE INDEX "forecast_snapshot_org_metric_grain_idx" ON "forecast_snapshot" USING btree ("organization_id","metric","grain","as_of");--> statement-breakpoint
-- Hand-written append-only guard (`DEC-011`): drizzle-kit cannot express
-- triggers. `forecast_override` reuses the shared `reject_immutable_change()`
-- function from `0002_invariants.sql` (the
-- `stock_movement`/`calculation_snapshot`/`audit_event` precedent): the row
-- trigger rejects UPDATE and DELETE and the statement trigger closes the
-- TRUNCATE bypass. A correction is a new override row, never an edit or delete.
CREATE TRIGGER "forecast_override_immutable"
  BEFORE UPDATE OR DELETE ON "forecast_override"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_immutable_change"();--> statement-breakpoint
CREATE TRIGGER "forecast_override_no_truncate"
  BEFORE TRUNCATE ON "forecast_override"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_immutable_change"();