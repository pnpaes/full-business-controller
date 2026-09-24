CREATE TABLE "recipe_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"tested_at" timestamp with time zone NOT NULL,
	"batch_input_qty" numeric(19, 6) NOT NULL,
	"actual_output_qty" numeric(19, 6),
	"actual_duration_minutes" integer,
	"actual_cost" numeric(19, 4),
	"currency" char(3),
	"quality_comments" text,
	"proposed_adjustment" text,
	"resulting_recipe_version_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_test_batch_input_qty_check" CHECK ("recipe_test"."batch_input_qty" > 0),
	CONSTRAINT "recipe_test_actual_output_qty_check" CHECK ("recipe_test"."actual_output_qty" is null or "recipe_test"."actual_output_qty" > 0),
	CONSTRAINT "recipe_test_actual_duration_minutes_check" CHECK ("recipe_test"."actual_duration_minutes" is null or "recipe_test"."actual_duration_minutes" >= 0),
	CONSTRAINT "recipe_test_actual_cost_check" CHECK ("recipe_test"."actual_cost" is null or "recipe_test"."actual_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recipe_version" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "recipe_test" ADD CONSTRAINT "recipe_test_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_test" ADD CONSTRAINT "recipe_test_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_test" ADD CONSTRAINT "recipe_test_resulting_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("resulting_recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_test_version_tested_idx" ON "recipe_test" USING btree ("recipe_version_id","tested_at");--> statement-breakpoint
CREATE INDEX "recipe_test_org_tested_idx" ON "recipe_test" USING btree ("organization_id","tested_at");