CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"audience" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_category_check" CHECK ("document"."category" in ('routine', 'guideline', 'policy', 'form', 'other')),
	CONSTRAINT "document_audience_check" CHECK ("document"."audience" in ('all_staff', 'managers')),
	CONSTRAINT "document_status_check" CHECK ("document"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "document_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"acknowledged_by" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_acknowledgement_version_user_key" UNIQUE("document_version_id","acknowledged_by")
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"file_object_id" uuid,
	"notes" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_version_document_version_key" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_version_version_no_check" CHECK ("document_version"."version_no" > 0),
	CONSTRAINT "document_version_published_check" CHECK (("document_version"."published_at" is null and "document_version"."published_by" is null) or ("document_version"."published_at" is not null and "document_version"."published_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgement" ADD CONSTRAINT "document_acknowledgement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgement" ADD CONSTRAINT "document_acknowledgement_document_version_id_document_version_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_org_status_idx" ON "document" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "document_org_audience_idx" ON "document" USING btree ("organization_id","audience");--> statement-breakpoint
CREATE INDEX "document_acknowledgement_org_version_idx" ON "document_acknowledgement" USING btree ("organization_id","document_version_id");--> statement-breakpoint
CREATE INDEX "document_acknowledgement_org_user_idx" ON "document_acknowledgement" USING btree ("organization_id","acknowledged_by");--> statement-breakpoint
CREATE INDEX "document_version_org_document_idx" ON "document_version" USING btree ("organization_id","document_id");