CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_delivery" boolean DEFAULT false NOT NULL,
	CONSTRAINT "channel_organization_id_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'operating' NOT NULL,
	"address" text,
	"active_from" date DEFAULT current_date NOT NULL,
	"active_to" date,
	CONSTRAINT "location_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "location_kind_check" CHECK ("location"."kind" in ('operating', 'central_production', 'virtual_transit')),
	CONSTRAINT "location_active_range_check" CHECK ("location"."active_to" is null or "location"."active_to" > "location"."active_from")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"timezone" text DEFAULT 'Europe/Oslo' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_transit" boolean DEFAULT false NOT NULL,
	CONSTRAINT "storage_area_location_id_code_key" UNIQUE("location_id","code"),
	CONSTRAINT "storage_area_kind_check" CHECK ("storage_area"."kind" in ('kitchen', 'dry_store', 'refrigerator', 'freezer', 'front_counter', 'transit', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"username" text,
	"email" text,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "app_user_status_check" CHECK ("app_user"."status" in ('invited', 'active', 'disabled', 'locked')),
	CONSTRAINT "app_user_failed_login_count_check" CHECK ("app_user"."failed_login_count" >= 0),
	CONSTRAINT "app_user_identifier_check" CHECK ("app_user"."username" is not null or "app_user"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" "inet",
	CONSTRAINT "auth_session_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_session_expiry_check" CHECK ("auth_session"."expires_at" > "auth_session"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "data_ownership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"data_area" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"review_cadence" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_ownership_data_area_check" CHECK ("data_ownership"."data_area" in ('products_recipes_allergens', 'supplier_items_costs', 'prices_channels_tax', 'inventory_waste', 'sales_mappings_settlements', 'labor_assumptions', 'competitor_observations', 'user_access_audit')),
	CONSTRAINT "data_ownership_effective_range_check" CHECK ("data_ownership"."effective_to" is null or "data_ownership"."effective_to" > "data_ownership"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "password_reset_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "role_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "role_code_check" CHECK ("role"."code" in ('owner', 'general_manager', 'location_manager', 'kitchen', 'front_of_house', 'purchasing', 'finance', 'admin', 'analyst', 'product_owner', 'technical_owner', 'data_owner'))
);
--> statement-breakpoint
CREATE TABLE "user_location_scope" (
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "user_location_scope_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"location_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_key" UNIQUE NULLS NOT DISTINCT("user_id","role_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "user_totp" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"recovery_codes_hash" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"store_name" text,
	"observed_at" date NOT NULL,
	"pack_size" numeric(19, 6),
	"pack_unit_id" uuid,
	"pack_price" numeric(19, 4),
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"source" text NOT NULL,
	"receipt_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_observation_pack_size_check" CHECK ("cost_observation"."pack_size" is null or "cost_observation"."pack_size" > 0),
	CONSTRAINT "cost_observation_pack_price_check" CHECK ("cost_observation"."pack_price" is null or "cost_observation"."pack_price" >= 0),
	CONSTRAINT "cost_observation_source_check" CHECK ("cost_observation"."source" in ('receipt', 'manual', 'excel'))
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"item_type" text NOT NULL,
	"base_unit_id" uuid NOT NULL,
	"inventory_policy" text DEFAULT 'stocked' NOT NULL,
	"lot_tracked" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"standard_portion_size" numeric(19, 6),
	"portion_unit_id" uuid,
	"current_cost" numeric(19, 4),
	"current_cost_updated_at" timestamp with time zone,
	"active_from" date DEFAULT current_date NOT NULL,
	"active_to" date,
	CONSTRAINT "item_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "item_organization_id_sku_key" UNIQUE("organization_id","sku"),
	CONSTRAINT "item_item_type_check" CHECK ("item"."item_type" in ('ingredient', 'packaging', 'cleaning_supply', 'consumable', 'intermediate', 'finished_good', 'non_stock_supply')),
	CONSTRAINT "item_inventory_policy_check" CHECK ("item"."inventory_policy" in ('stocked', 'non_stock', 'made_to_order')),
	CONSTRAINT "item_shelf_life_days_check" CHECK ("item"."shelf_life_days" is null or "item"."shelf_life_days" >= 0),
	CONSTRAINT "item_standard_portion_size_check" CHECK ("item"."standard_portion_size" is null or "item"."standard_portion_size" > 0),
	CONSTRAINT "item_current_cost_check" CHECK ("item"."current_cost" is null or "item"."current_cost" >= 0),
	CONSTRAINT "item_active_range_check" CHECK ("item"."active_to" is null or "item"."active_to" > "item"."active_from")
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"dimension" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	CONSTRAINT "unit_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "unit_dimension_check" CHECK ("unit"."dimension" in ('mass', 'volume', 'count', 'time', 'package'))
);
--> statement-breakpoint
CREATE TABLE "channel_fee_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"fee_kind" text NOT NULL,
	"percentage_rate" numeric(9, 6),
	"fixed_amount" numeric(19, 4),
	"fee_basis" text NOT NULL,
	"tax_rule_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "channel_fee_rule_fee_kind_check" CHECK ("channel_fee_rule"."fee_kind" in ('commission_pct', 'processing_pct', 'fixed_per_order', 'delivery_subsidy', 'discount_funding')),
	CONSTRAINT "channel_fee_rule_fee_basis_check" CHECK ("channel_fee_rule"."fee_basis" in ('gross_price', 'net_price', 'per_order')),
	CONSTRAINT "channel_fee_rule_percentage_rate_check" CHECK ("channel_fee_rule"."percentage_rate" is null or "channel_fee_rule"."percentage_rate" >= 0),
	CONSTRAINT "channel_fee_rule_fixed_amount_check" CHECK ("channel_fee_rule"."fixed_amount" is null or "channel_fee_rule"."fixed_amount" >= 0),
	CONSTRAINT "channel_fee_rule_effective_range_check" CHECK ("channel_fee_rule"."effective_to" is null or "channel_fee_rule"."effective_to" > "channel_fee_rule"."effective_from"),
	CONSTRAINT "channel_fee_rule_amount_kind_check" CHECK (case "channel_fee_rule"."fee_kind"
        when 'commission_pct' then "channel_fee_rule"."percentage_rate" is not null and "channel_fee_rule"."fixed_amount" is null
        when 'processing_pct' then "channel_fee_rule"."percentage_rate" is not null and "channel_fee_rule"."fixed_amount" is null
        when 'fixed_per_order' then "channel_fee_rule"."fixed_amount" is not null and "channel_fee_rule"."percentage_rate" is null
        when 'delivery_subsidy' then "channel_fee_rule"."fixed_amount" is not null and "channel_fee_rule"."percentage_rate" is null
        when 'discount_funding' then "channel_fee_rule"."fixed_amount" is not null and "channel_fee_rule"."percentage_rate" is null
        else false
      end)
);
--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"base_currency" char(3) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"rate" numeric(19, 10) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text DEFAULT 'norges_bank' NOT NULL,
	CONSTRAINT "exchange_rate_org_pair_date_key" UNIQUE("organization_id","base_currency","quote_currency","rate_date"),
	CONSTRAINT "exchange_rate_rate_check" CHECK ("exchange_rate"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "tax_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate_pct" numeric(9, 6) NOT NULL,
	"tax_treatment" text DEFAULT 'channel_overridable' NOT NULL,
	"tax_basis" text NOT NULL,
	"recoverable" boolean DEFAULT false NOT NULL,
	"applies_to" text NOT NULL,
	"scope_type" text DEFAULT 'company_wide' NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rule_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "tax_rule_rate_pct_check" CHECK ("tax_rule"."rate_pct" >= 0),
	CONSTRAINT "tax_rule_tax_treatment_check" CHECK ("tax_rule"."tax_treatment" in ('fixed', 'channel_overridable')),
	CONSTRAINT "tax_rule_tax_basis_check" CHECK ("tax_rule"."tax_basis" in ('inclusive', 'exclusive')),
	CONSTRAINT "tax_rule_applies_to_check" CHECK ("tax_rule"."applies_to" in ('product', 'service', 'fee', 'cost')),
	CONSTRAINT "tax_rule_scope_type_check" CHECK ("tax_rule"."scope_type" in ('organization', 'location', 'storage', 'channel', 'company_wide')),
	CONSTRAINT "tax_rule_effective_range_check" CHECK ("tax_rule"."effective_to" is null or "tax_rule"."effective_to" > "tax_rule"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "supplier_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_item_id" uuid NOT NULL,
	"gross_pack_price" numeric(19, 4) NOT NULL,
	"discount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"tax_basis" text NOT NULL,
	"tax_rule_id" uuid,
	"allocated_freight" numeric(19, 4) DEFAULT '0' NOT NULL,
	"import_fee" numeric(19, 4) DEFAULT '0' NOT NULL,
	"other_cost" numeric(19, 4) DEFAULT '0' NOT NULL,
	"net_pack_price" numeric(19, 4) NOT NULL,
	"landed_pack_cost" numeric(19, 4) NOT NULL,
	"landed_base_unit_cost" numeric(19, 4) NOT NULL,
	"currency" char(3) DEFAULT 'NOK' NOT NULL,
	"source_receipt_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "supplier_price_gross_pack_price_check" CHECK ("supplier_price"."gross_pack_price" >= 0),
	CONSTRAINT "supplier_price_discount_check" CHECK ("supplier_price"."discount" >= 0),
	CONSTRAINT "supplier_price_tax_basis_check" CHECK ("supplier_price"."tax_basis" in ('inclusive', 'exclusive')),
	CONSTRAINT "supplier_price_effective_range_check" CHECK ("supplier_price"."effective_to" is null or "supplier_price"."effective_to" > "supplier_price"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"output_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_organization_id_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "recipe_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"component_kind" text NOT NULL,
	"item_id" uuid,
	"sub_recipe_id" uuid,
	"quantity" numeric(19, 6) NOT NULL,
	"unit_id" uuid NOT NULL,
	"loss_factor" numeric(9, 6) DEFAULT '1' NOT NULL,
	"stage" text,
	"substitution_group" text,
	CONSTRAINT "recipe_line_component_kind_check" CHECK ("recipe_line"."component_kind" in ('ingredient', 'packaging', 'sub_recipe')),
	CONSTRAINT "recipe_line_quantity_check" CHECK ("recipe_line"."quantity" > 0),
	CONSTRAINT "recipe_line_loss_factor_check" CHECK ("recipe_line"."loss_factor" > 0 and "recipe_line"."loss_factor" <= 1),
	CONSTRAINT "recipe_line_component_ref_check" CHECK (("recipe_line"."item_id" is not null)::int + ("recipe_line"."sub_recipe_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "recipe_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"planned_input_qty" numeric(19, 6) NOT NULL,
	"planned_output_qty" numeric(19, 6) NOT NULL,
	"approved_usable_output" numeric(19, 6) NOT NULL,
	"yield_rate" numeric(9, 6) NOT NULL,
	"preparation_minutes" integer,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "recipe_version_recipe_id_version_no_key" UNIQUE("recipe_id","version_no"),
	CONSTRAINT "recipe_version_state_check" CHECK ("recipe_version"."state" in ('draft', 'submitted', 'approved', 'rejected', 'retired')),
	CONSTRAINT "recipe_version_planned_input_qty_check" CHECK ("recipe_version"."planned_input_qty" > 0),
	CONSTRAINT "recipe_version_planned_output_qty_check" CHECK ("recipe_version"."planned_output_qty" > 0),
	CONSTRAINT "recipe_version_approved_usable_output_check" CHECK ("recipe_version"."approved_usable_output" > 0),
	CONSTRAINT "recipe_version_yield_rate_check" CHECK ("recipe_version"."yield_rate" > 0 and "recipe_version"."yield_rate" <= 1),
	CONSTRAINT "recipe_version_preparation_minutes_check" CHECK ("recipe_version"."preparation_minutes" is null or "recipe_version"."preparation_minutes" >= 0),
	CONSTRAINT "recipe_version_effective_range_check" CHECK ("recipe_version"."effective_to" is null or "recipe_version"."effective_to" > "recipe_version"."effective_from"),
	CONSTRAINT "recipe_version_approval_check" CHECK ("recipe_version"."state" <> 'approved' or ("recipe_version"."approved_by" is not null and "recipe_version"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "addon_applicability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"addon_product_id" uuid NOT NULL,
	"base_product_id" uuid NOT NULL,
	"price_effect" numeric(19, 4),
	"active_from" date DEFAULT current_date NOT NULL,
	"active_to" date,
	CONSTRAINT "addon_applicability_distinct_products_check" CHECK ("addon_applicability"."addon_product_id" <> "addon_applicability"."base_product_id"),
	CONSTRAINT "addon_applicability_active_range_check" CHECK ("addon_applicability"."active_to" is null or "addon_applicability"."active_to" > "addon_applicability"."active_from")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"product_kind" text DEFAULT 'base' NOT NULL,
	"active_from" date DEFAULT current_date NOT NULL,
	"active_to" date,
	CONSTRAINT "product_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "product_product_kind_check" CHECK ("product"."product_kind" in ('base', 'variant', 'add_on')),
	CONSTRAINT "product_active_range_check" CHECK ("product"."active_to" is null or "product"."active_to" > "product"."active_from")
);
--> statement-breakpoint
CREATE TABLE "product_recipe_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "product_recipe_assignment_effective_range_check" CHECK ("product_recipe_assignment"."effective_to" is null or "product_recipe_assignment"."effective_to" > "product_recipe_assignment"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"size" text,
	"finished_good_item_id" uuid,
	"active_from" date DEFAULT current_date NOT NULL,
	"active_to" date,
	CONSTRAINT "product_variant_product_id_code_key" UNIQUE("product_id","code"),
	CONSTRAINT "product_variant_organization_id_sku_key" UNIQUE("organization_id","sku"),
	CONSTRAINT "product_variant_active_range_check" CHECK ("product_variant"."active_to" is null or "product_variant"."active_to" > "product_variant"."active_from")
);
--> statement-breakpoint
CREATE TABLE "calculation_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cost_card_id" uuid,
	"price_scenario_id" uuid,
	"cost_selection_policy" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"tax_rule_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fx_rate_id" uuid,
	"rounding_method" text DEFAULT 'HALF_UP' NOT NULL,
	"rounding_scales" jsonb DEFAULT '{"qty":6,"money":4,"presented":2}'::jsonb NOT NULL,
	"rule_version" text NOT NULL,
	"totals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calculation_snapshot_rounding_method_check" CHECK ("calculation_snapshot"."rounding_method" in ('HALF_UP', 'HALF_EVEN')),
	CONSTRAINT "calculation_snapshot_source_check" CHECK (("calculation_snapshot"."cost_card_id" is not null)::int + ("calculation_snapshot"."price_scenario_id" is not null)::int = 1),
	CONSTRAINT "calculation_snapshot_tax_rule_snapshot_check" CHECK (jsonb_typeof("calculation_snapshot"."tax_rule_snapshot") = 'object'),
	CONSTRAINT "calculation_snapshot_rounding_scales_check" CHECK (jsonb_typeof("calculation_snapshot"."rounding_scales") = 'object'),
	CONSTRAINT "calculation_snapshot_totals_check" CHECK (jsonb_typeof("calculation_snapshot"."totals") = 'object')
);
--> statement-breakpoint
CREATE TABLE "cost_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"channel_id" uuid,
	"recipe_version_id" uuid,
	"state" text DEFAULT 'draft' NOT NULL,
	"cost_selection_policy" text DEFAULT 'latest_approved_price' NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"snapshot_id" uuid,
	CONSTRAINT "cost_card_state_check" CHECK ("cost_card"."state" in ('draft', 'approved', 'superseded')),
	CONSTRAINT "cost_card_approval_check" CHECK ("cost_card"."state" <> 'approved' or ("cost_card"."approved_by" is not null and "cost_card"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "price_scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"gross_price" numeric(19, 4),
	"net_price" numeric(19, 4),
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_scenario_state_check" CHECK ("price_scenario"."state" in ('draft', 'submitted', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"component_kind" text NOT NULL,
	"item_id" uuid,
	"quantity" numeric(19, 6),
	"unit_id" uuid,
	"unit_cost" numeric(19, 4),
	"amount" numeric(19, 4),
	"rounding_boundary" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "snapshot_component_rounding_boundary_check" CHECK ("snapshot_component"."rounding_boundary" in ('B0', 'B1', 'B2', 'B3', 'B4'))
);
--> statement-breakpoint
CREATE TABLE "stock_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_area_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity_on_hand" numeric(19, 6) DEFAULT '0' NOT NULL,
	"value_on_hand" numeric(19, 4) DEFAULT '0' NOT NULL,
	"avg_unit_cost" numeric(19, 4),
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "stock_balance_key" UNIQUE NULLS NOT DISTINCT("item_id","location_id","storage_area_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "stock_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_number" text,
	"expiry_date" date,
	"opened_date" date,
	"received_at" timestamp with time zone,
	"source_movement_id" uuid,
	CONSTRAINT "stock_lot_item_id_location_id_lot_number_key" UNIQUE("item_id","location_id","lot_number")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_area_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"movement_type" text NOT NULL,
	"quantity_delta" numeric(19, 6) NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_cost" numeric(19, 4),
	"value_delta" numeric(19, 4),
	"currency" char(3),
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reversal_of_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid NOT NULL,
	"reason_code" text,
	"idempotency_key" text,
	CONSTRAINT "stock_movement_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "stock_movement_movement_type_check" CHECK ("stock_movement"."movement_type" in ('receipt', 'receipt_reversal', 'production_consumption', 'production_output', 'sale_consumption', 'transfer_dispatch', 'transfer_receipt', 'waste', 'count_adjustment', 'correction', 'revaluation')),
	CONSTRAINT "stock_movement_source_type_check" CHECK ("stock_movement"."source_type" in ('goods_receipt', 'production_batch', 'transfer', 'stock_count', 'sales_line', 'waste_event', 'adjustment', 'revaluation', 'correction')),
	CONSTRAINT "stock_movement_quantity_or_value_check" CHECK ("stock_movement"."quantity_delta" <> 0 or coalesce("stock_movement"."value_delta", 0) <> 0),
	CONSTRAINT "stock_movement_unit_cost_check" CHECK ("stock_movement"."unit_cost" is null or "stock_movement"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"impersonation_context" jsonb,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_version" integer,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"correlation_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_area" ADD CONSTRAINT "storage_area_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_area" ADD CONSTRAINT "storage_area_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ownership" ADD CONSTRAINT "data_ownership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ownership" ADD CONSTRAINT "data_ownership_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ownership" ADD CONSTRAINT "data_ownership_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_observation" ADD CONSTRAINT "cost_observation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_observation" ADD CONSTRAINT "cost_observation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_observation" ADD CONSTRAINT "cost_observation_pack_unit_id_unit_id_fk" FOREIGN KEY ("pack_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_base_unit_id_unit_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_portion_unit_id_unit_id_fk" FOREIGN KEY ("portion_unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_fee_rule" ADD CONSTRAINT "channel_fee_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_fee_rule" ADD CONSTRAINT "channel_fee_rule_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_fee_rule" ADD CONSTRAINT "channel_fee_rule_tax_rule_id_tax_rule_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "public"."tax_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_tax_rule_id_tax_rule_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "public"."tax_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_output_item_id_item_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_sub_recipe_id_recipe_id_fk" FOREIGN KEY ("sub_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_applicability" ADD CONSTRAINT "addon_applicability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_applicability" ADD CONSTRAINT "addon_applicability_addon_product_id_product_id_fk" FOREIGN KEY ("addon_product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_applicability" ADD CONSTRAINT "addon_applicability_base_product_id_product_id_fk" FOREIGN KEY ("base_product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_assignment" ADD CONSTRAINT "product_recipe_assignment_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_assignment" ADD CONSTRAINT "product_recipe_assignment_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_assignment" ADD CONSTRAINT "product_recipe_assignment_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_finished_good_item_id_item_id_fk" FOREIGN KEY ("finished_good_item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_snapshot" ADD CONSTRAINT "calculation_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_snapshot" ADD CONSTRAINT "calculation_snapshot_price_scenario_id_price_scenario_id_fk" FOREIGN KEY ("price_scenario_id") REFERENCES "public"."price_scenario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_snapshot" ADD CONSTRAINT "calculation_snapshot_fx_rate_id_exchange_rate_id_fk" FOREIGN KEY ("fx_rate_id") REFERENCES "public"."exchange_rate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_card" ADD CONSTRAINT "cost_card_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_scenario" ADD CONSTRAINT "price_scenario_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_scenario" ADD CONSTRAINT "price_scenario_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_scenario" ADD CONSTRAINT "price_scenario_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_scenario" ADD CONSTRAINT "price_scenario_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_component" ADD CONSTRAINT "snapshot_component_snapshot_id_calculation_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."calculation_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_component" ADD CONSTRAINT "snapshot_component_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_component" ADD CONSTRAINT "snapshot_component_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reversal_of_id_stock_movement_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id") WHERE "auth_session"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "data_ownership_org_area_idx" ON "data_ownership" USING btree ("organization_id","data_area");--> statement-breakpoint
CREATE INDEX "cost_observation_item_idx" ON "cost_observation" USING btree ("organization_id","item_id","observed_at");--> statement-breakpoint
CREATE INDEX "recipe_line_version_idx" ON "recipe_line" USING btree ("recipe_version_id");--> statement-breakpoint
CREATE INDEX "addon_applicability_base_idx" ON "addon_applicability" USING btree ("organization_id","base_product_id");--> statement-breakpoint
CREATE INDEX "cost_card_variant_idx" ON "cost_card" USING btree ("organization_id","product_variant_id","location_id","calculated_at");--> statement-breakpoint
CREATE INDEX "price_scenario_variant_idx" ON "price_scenario" USING btree ("organization_id","product_variant_id");--> statement-breakpoint
CREATE INDEX "snapshot_component_snapshot_idx" ON "snapshot_component" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "stock_movement_balance_idx" ON "stock_movement" USING btree ("organization_id","item_id","location_id","storage_area_id","lot_id","occurred_at","posted_at");--> statement-breakpoint
CREATE INDEX "stock_movement_source_idx" ON "stock_movement" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "stock_movement_reversal_idx" ON "stock_movement" USING btree ("reversal_of_id") WHERE "stock_movement"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_event" USING btree ("occurred_at") WHERE "outbox_event"."published_at" is null;