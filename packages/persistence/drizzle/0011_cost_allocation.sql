CREATE TABLE "allocation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_pool_id" uuid NOT NULL,
	"driver" text NOT NULL,
	"scope_type" text NOT NULL,
	"denominator_source" text NOT NULL,
	"fallback_behavior" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_rule_driver_check" CHECK ("allocation_rule"."driver" in ('direct_location_assignment', 'occupied_area', 'equipment_use', 'production_hours', 'production_minutes', 'operating_hours', 'transactions', 'revenue', 'recorded_time', 'eligible_products', 'equal_share')),
	CONSTRAINT "allocation_rule_scope_type_check" CHECK ("allocation_rule"."scope_type" in ('organization', 'location', 'storage', 'channel', 'company_wide')),
	CONSTRAINT "allocation_rule_denominator_source_check" CHECK (length(btrim("allocation_rule"."denominator_source")) > 0),
	CONSTRAINT "allocation_rule_fallback_behavior_check" CHECK ("allocation_rule"."fallback_behavior" in ('stop', 'equal_share')),
	CONSTRAINT "allocation_rule_effective_range_check" CHECK ("allocation_rule"."effective_to" is null or "allocation_rule"."effective_to" > "allocation_rule"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "cost_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_pool_effective_range_check" CHECK ("cost_pool"."effective_to" is null or "cost_pool"."effective_to" > "cost_pool"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "labor_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"loaded_hourly_rate" numeric(19, 4) NOT NULL,
	"productive_hours_pct" numeric(6, 4),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labor_rate_role_code_check" CHECK ("labor_rate"."role_code" in ('owner', 'general_manager', 'location_manager', 'kitchen', 'front_of_house', 'purchasing', 'finance', 'admin', 'analyst', 'product_owner', 'technical_owner', 'data_owner')),
	CONSTRAINT "labor_rate_loaded_hourly_rate_check" CHECK ("labor_rate"."loaded_hourly_rate" >= 0),
	CONSTRAINT "labor_rate_productive_hours_pct_check" CHECK ("labor_rate"."productive_hours_pct" is null or ("labor_rate"."productive_hours_pct" > 0 and "labor_rate"."productive_hours_pct" <= 1)),
	CONSTRAINT "labor_rate_effective_range_check" CHECK ("labor_rate"."effective_to" is null or "labor_rate"."effective_to" > "labor_rate"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "operating_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"cost_center_id" uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"recurrence" text NOT NULL,
	"behavior" text NOT NULL,
	"tax_basis" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"vendor" text,
	"evidence_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_cost_recurrence_check" CHECK ("operating_cost"."recurrence" in ('one_off', 'daily', 'weekly', 'monthly', 'quarterly', 'annual')),
	CONSTRAINT "operating_cost_behavior_check" CHECK ("operating_cost"."behavior" in ('fixed', 'variable', 'mixed')),
	CONSTRAINT "operating_cost_tax_basis_check" CHECK ("operating_cost"."tax_basis" in ('inclusive', 'exclusive')),
	CONSTRAINT "operating_cost_amount_check" CHECK ("operating_cost"."amount" >= 0),
	CONSTRAINT "operating_cost_effective_range_check" CHECK ("operating_cost"."effective_to" is null or "operating_cost"."effective_to" > "operating_cost"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "allocation_rule" ADD CONSTRAINT "allocation_rule_cost_pool_id_cost_pool_id_fk" FOREIGN KEY ("cost_pool_id") REFERENCES "public"."cost_pool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_pool" ADD CONSTRAINT "cost_pool_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_rate" ADD CONSTRAINT "labor_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_rate" ADD CONSTRAINT "labor_rate_cost_center_id_cost_center_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_center"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_cost" ADD CONSTRAINT "operating_cost_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_cost" ADD CONSTRAINT "operating_cost_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_cost" ADD CONSTRAINT "operating_cost_cost_center_id_cost_center_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_center"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_rule_cost_pool_idx" ON "allocation_rule" USING btree ("cost_pool_id");--> statement-breakpoint
CREATE INDEX "cost_pool_organization_id_code_idx" ON "cost_pool" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "operating_cost_lookup_idx" ON "operating_cost" USING btree ("organization_id","cost_center_id","effective_from");