CREATE TABLE "data_quality_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "data_quality_exception_severity_check" CHECK ("data_quality_exception"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "data_quality_exception_status_check" CHECK ("data_quality_exception"."status" in ('open', 'acknowledged', 'resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "data_quality_exception" ADD CONSTRAINT "data_quality_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_quality_exception_org_status_idx" ON "data_quality_exception" USING btree ("organization_id","status","severity","detected_at");--> statement-breakpoint
CREATE INDEX "data_quality_exception_org_entity_idx" ON "data_quality_exception" USING btree ("organization_id","entity_type","entity_id");