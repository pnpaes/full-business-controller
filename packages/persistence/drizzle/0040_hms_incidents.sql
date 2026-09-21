CREATE TABLE "corrective_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid,
	"monitoring_reading_id" uuid,
	"description" text NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"status" text NOT NULL,
	"completed_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "corrective_action_status_check" CHECK ("corrective_action"."status" in ('open', 'in_progress', 'done', 'verified'))
);
--> statement-breakpoint
CREATE TABLE "hms_incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"reported_by" uuid NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"due_date" date,
	"involves_personal_data" boolean NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "hms_incident_category_check" CHECK ("hms_incident"."category" in ('work_accident', 'electrical', 'equipment', 'fire', 'near_miss', 'other')),
	CONSTRAINT "hms_incident_severity_check" CHECK ("hms_incident"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "hms_incident_status_check" CHECK ("hms_incident"."status" in ('open', 'investigating', 'resolved', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_incident_id_hms_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."hms_incident"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_action" ADD CONSTRAINT "corrective_action_monitoring_reading_id_monitoring_reading_id_fk" FOREIGN KEY ("monitoring_reading_id") REFERENCES "public"."monitoring_reading"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_incident" ADD CONSTRAINT "hms_incident_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_incident" ADD CONSTRAINT "hms_incident_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrective_action_org_incident_idx" ON "corrective_action" USING btree ("organization_id","incident_id");--> statement-breakpoint
CREATE INDEX "corrective_action_org_status_due_idx" ON "corrective_action" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "hms_incident_org_status_occurred_idx" ON "hms_incident" USING btree ("organization_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "hms_incident_org_location_idx" ON "hms_incident" USING btree ("organization_id","location_id");