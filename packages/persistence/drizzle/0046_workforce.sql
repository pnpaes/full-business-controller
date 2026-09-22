CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"role_code" text NOT NULL,
	"employment_type" text NOT NULL,
	"base_hourly_rate" numeric(19, 4) NOT NULL,
	"cost_center_id" uuid,
	"primary_location_id" uuid,
	"active_from" date NOT NULL,
	"active_to" date,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employee_employment_type_check" CHECK ("employee"."employment_type" in ('full_time', 'part_time', 'on_call', 'temporary', 'apprentice')),
	CONSTRAINT "employee_base_hourly_rate_check" CHECK ("employee"."base_hourly_rate" >= 0),
	CONSTRAINT "employee_active_range_check" CHECK ("employee"."active_to" is null or "employee"."active_to" > "employee"."active_from")
);
--> statement-breakpoint
CREATE TABLE "employee_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_object_id" uuid,
	"issued_at" date,
	"expires_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employee_document_kind_check" CHECK ("employee_document"."kind" in ('contract', 'certificate', 'id_document', 'other'))
);
--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_primary_location_id_location_id_fk" FOREIGN KEY ("primary_location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_org_active_idx" ON "employee" USING btree ("organization_id","retired_at");--> statement-breakpoint
CREATE INDEX "employee_org_primary_location_idx" ON "employee" USING btree ("organization_id","primary_location_id");--> statement-breakpoint
CREATE INDEX "employee_document_org_employee_idx" ON "employee_document" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_document_org_kind_idx" ON "employee_document" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "employee_document_org_expires_idx" ON "employee_document" USING btree ("organization_id","expires_at");