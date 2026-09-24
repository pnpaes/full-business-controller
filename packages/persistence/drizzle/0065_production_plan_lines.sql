CREATE TABLE "production_plan_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"planned_qty" numeric(19, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_plan_line_planned_qty_check" CHECK ("production_plan_line"."planned_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_batch" ADD COLUMN "planned_qty" numeric(19, 6);--> statement-breakpoint
ALTER TABLE "production_plan_line" ADD CONSTRAINT "production_plan_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_line" ADD CONSTRAINT "production_plan_line_plan_id_production_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_line" ADD CONSTRAINT "production_plan_line_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_plan_line_plan_idx" ON "production_plan_line" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_planned_qty_check" CHECK ("production_batch"."planned_qty" is null or "production_batch"."planned_qty" > 0);