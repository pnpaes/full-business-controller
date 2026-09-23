ALTER TABLE "recipe_version" ADD COLUMN "labor_cost_center_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_version" ADD COLUMN "labor_role_code" text;--> statement-breakpoint
ALTER TABLE "operating_cost" ADD COLUMN "cost_pool_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_labor_cost_center_id_cost_center_id_fk" FOREIGN KEY ("labor_cost_center_id") REFERENCES "public"."cost_center"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_cost" ADD CONSTRAINT "operating_cost_cost_pool_id_cost_pool_id_fk" FOREIGN KEY ("cost_pool_id") REFERENCES "public"."cost_pool"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_version_labor_idx" ON "recipe_version" USING btree ("labor_cost_center_id","labor_role_code");--> statement-breakpoint
CREATE INDEX "operating_cost_pool_idx" ON "operating_cost" USING btree ("organization_id","cost_pool_id","effective_from");--> statement-breakpoint
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_labor_role_code_check" CHECK ("recipe_version"."labor_role_code" in ('owner', 'general_manager', 'location_manager', 'kitchen', 'front_of_house', 'purchasing', 'finance', 'admin', 'analyst', 'product_owner', 'technical_owner', 'data_owner'));--> statement-breakpoint
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_labor_mapping_check" CHECK (("recipe_version"."labor_cost_center_id" is null) = ("recipe_version"."labor_role_code" is null));