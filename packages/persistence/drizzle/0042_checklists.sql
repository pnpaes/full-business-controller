CREATE TABLE "checklist_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"performed_by" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_run_status_check" CHECK ("checklist_run"."status" in ('in_progress', 'completed')),
	CONSTRAINT "checklist_run_results_array_check" CHECK (jsonb_typeof("checklist_run"."results") = 'array')
);
--> statement-breakpoint
CREATE TABLE "checklist_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"frequency" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "checklist_template_category_check" CHECK ("checklist_template"."category" in ('opening', 'closing', 'cleaning', 'hygiene', 'food_safety', 'other')),
	CONSTRAINT "checklist_template_frequency_check" CHECK ("checklist_template"."frequency" in ('daily', 'twice_daily', 'weekly', 'monthly', 'other')),
	CONSTRAINT "checklist_template_items_array_check" CHECK (jsonb_typeof("checklist_template"."items") = 'array'),
	CONSTRAINT "checklist_template_supersedes_self_check" CHECK ("checklist_template"."supersedes_id" <> "checklist_template"."id")
);
--> statement-breakpoint
ALTER TABLE "checklist_run" ADD CONSTRAINT "checklist_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_run" ADD CONSTRAINT "checklist_run_template_id_checklist_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_run" ADD CONSTRAINT "checklist_run_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template" ADD CONSTRAINT "checklist_template_supersedes_id_checklist_template_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."checklist_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_run_org_location_run_idx" ON "checklist_run" USING btree ("organization_id","location_id","run_at");--> statement-breakpoint
CREATE INDEX "checklist_run_org_template_idx" ON "checklist_run" USING btree ("organization_id","template_id");--> statement-breakpoint
CREATE INDEX "checklist_run_org_status_idx" ON "checklist_run" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "checklist_template_org_category_idx" ON "checklist_template" USING btree ("organization_id","category");