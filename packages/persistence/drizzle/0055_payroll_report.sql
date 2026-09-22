CREATE TABLE "payroll_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"export_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payroll_report_status_check" CHECK ("payroll_report"."status" in ('draft', 'generated', 'exported', 'superseded')),
	CONSTRAINT "payroll_report_period_check" CHECK ("payroll_report"."period_end" > "payroll_report"."period_start")
);
--> statement-breakpoint
ALTER TABLE "payroll_report" ADD CONSTRAINT "payroll_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_report" ADD CONSTRAINT "payroll_report_export_file_id_file_object_id_fk" FOREIGN KEY ("export_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_report_org_period_key" ON "payroll_report" USING btree ("organization_id","period_start") WHERE "payroll_report"."status" <> 'superseded';--> statement-breakpoint
CREATE INDEX "payroll_report_org_status_idx" ON "payroll_report" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "payroll_report_org_period_idx" ON "payroll_report" USING btree ("organization_id","period_start","period_end");