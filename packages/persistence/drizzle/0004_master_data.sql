CREATE TABLE "cost_center" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "cost_center_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "cost_center_kind_check" CHECK ("cost_center"."kind" in ('company_shared', 'location', 'kitchen', 'front_of_house', 'project'))
);
--> statement-breakpoint
CREATE TABLE "unit_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_unit_id" uuid NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"factor" numeric(19, 6) NOT NULL,
	"item_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "unit_conversion_factor_check" CHECK ("unit_conversion"."factor" > 0),
	CONSTRAINT "unit_conversion_effective_range_check" CHECK ("unit_conversion"."effective_to" is null or "unit_conversion"."effective_to" > "unit_conversion"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"terms" text,
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "supplier_organization_id_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "supplier_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_sku" text NOT NULL,
	"pack_unit_id" uuid NOT NULL,
	"pack_to_base_unit_factor" numeric(19, 6) NOT NULL,
	"min_order_qty" numeric(19, 6),
	"lead_time_days" integer,
	"preferred" boolean DEFAULT false NOT NULL,
	CONSTRAINT "supplier_item_supplier_id_supplier_sku_key" UNIQUE("supplier_id","supplier_sku"),
	CONSTRAINT "supplier_item_pack_to_base_unit_factor_check" CHECK ("supplier_item"."pack_to_base_unit_factor" > 0),
	CONSTRAINT "supplier_item_min_order_qty_check" CHECK ("supplier_item"."min_order_qty" is null or "supplier_item"."min_order_qty" > 0),
	CONSTRAINT "supplier_item_lead_time_days_check" CHECK ("supplier_item"."lead_time_days" is null or "supplier_item"."lead_time_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_center" ADD CONSTRAINT "cost_center_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_from_unit_id_unit_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_to_unit_id_unit_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_item" ADD CONSTRAINT "supplier_item_pack_unit_id_unit_id_fk" FOREIGN KEY ("pack_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_conversion_lookup_idx" ON "unit_conversion" USING btree ("organization_id","from_unit_id","to_unit_id");