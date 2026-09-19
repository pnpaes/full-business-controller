CREATE TABLE "goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid,
	"store_name" text,
	"location_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"delivery_ref" text,
	"received_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"reversal_of_id" uuid,
	"evidence_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "goods_receipt_status_check" CHECK ("goods_receipt"."status" in ('draft', 'submitted', 'accepted', 'rejected', 'reversed')),
	CONSTRAINT "goods_receipt_supplier_or_store_check" CHECK ("goods_receipt"."supplier_id" is not null or ("goods_receipt"."store_name" is not null and btrim("goods_receipt"."store_name") <> '')),
	CONSTRAINT "goods_receipt_accepted_check" CHECK ("goods_receipt"."status" <> 'accepted' or ("goods_receipt"."accepted_by" is not null and "goods_receipt"."accepted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"supplier_item_id" uuid,
	"item_id" uuid NOT NULL,
	"received_pack_qty" numeric(19, 6) NOT NULL,
	"accepted_pack_qty" numeric(19, 6) NOT NULL,
	"rejected_pack_qty" numeric(19, 6) DEFAULT '0' NOT NULL,
	"unit_id" uuid NOT NULL,
	"pack_to_base_factor" numeric(19, 6) NOT NULL,
	"price" numeric(19, 4) NOT NULL,
	"discount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_basis" text NOT NULL,
	"tax_code_id" uuid,
	"allocated_freight" numeric(19, 4) DEFAULT '0' NOT NULL,
	"import_fee" numeric(19, 4) DEFAULT '0' NOT NULL,
	"lot_number" text,
	"expiry_date" date,
	"base_qty_accepted" numeric(19, 6) NOT NULL,
	"landed_base_unit_cost" numeric(19, 4) NOT NULL,
	CONSTRAINT "goods_receipt_line_tax_basis_check" CHECK ("goods_receipt_line"."tax_basis" in ('inclusive', 'exclusive')),
	CONSTRAINT "goods_receipt_line_received_pack_qty_check" CHECK ("goods_receipt_line"."received_pack_qty" >= 0),
	CONSTRAINT "goods_receipt_line_accepted_pack_qty_check" CHECK ("goods_receipt_line"."accepted_pack_qty" >= 0),
	CONSTRAINT "goods_receipt_line_rejected_pack_qty_check" CHECK ("goods_receipt_line"."rejected_pack_qty" >= 0),
	CONSTRAINT "goods_receipt_line_accepted_le_received_check" CHECK ("goods_receipt_line"."accepted_pack_qty" <= "goods_receipt_line"."received_pack_qty"),
	CONSTRAINT "goods_receipt_line_pack_to_base_factor_check" CHECK ("goods_receipt_line"."pack_to_base_factor" > 0),
	CONSTRAINT "goods_receipt_line_price_check" CHECK ("goods_receipt_line"."price" >= 0),
	CONSTRAINT "goods_receipt_line_discount_check" CHECK ("goods_receipt_line"."discount" >= 0),
	CONSTRAINT "goods_receipt_line_allocated_freight_check" CHECK ("goods_receipt_line"."allocated_freight" >= 0),
	CONSTRAINT "goods_receipt_line_import_fee_check" CHECK ("goods_receipt_line"."import_fee" >= 0),
	CONSTRAINT "goods_receipt_line_base_qty_accepted_check" CHECK ("goods_receipt_line"."base_qty_accepted" > 0),
	CONSTRAINT "goods_receipt_line_landed_base_unit_cost_check" CHECK ("goods_receipt_line"."landed_base_unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_reversal_of_id_goods_receipt_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."goods_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_goods_receipt_id_goods_receipt_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tax_code_id_tax_rule_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_org_received_idx" ON "goods_receipt" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "goods_receipt_line_receipt_idx" ON "goods_receipt_line" USING btree ("goods_receipt_id");