CREATE TABLE "integration_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_type" text NOT NULL,
	"direction" text DEFAULT 'read' NOT NULL,
	"allowed_operations" text[] DEFAULT '{}'::text[] NOT NULL,
	"credentials_owner" text NOT NULL,
	"rate_limit_note" text,
	"terms_status" text DEFAULT 'pending' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "integration_source_organization_id_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "integration_source_system_type_check" CHECK ("integration_source"."system_type" in ('pos', 'medusa', 'sanity', 'wolt', 'fiken', 'other')),
	CONSTRAINT "integration_source_direction_check" CHECK ("integration_source"."direction" in ('read', 'write', 'read_write')),
	CONSTRAINT "integration_source_terms_status_check" CHECK ("integration_source"."terms_status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "integration_source_allowed_operations_check" CHECK ("integration_source"."allowed_operations" <@ array['read', 'write_price', 'write_menu_product', 'write_stock', 'write_accounting']::text[]),
	CONSTRAINT "integration_source_write_requires_approved_terms_check" CHECK ("integration_source"."terms_status" = 'approved' or not ("integration_source"."allowed_operations" && array['write_price', 'write_menu_product', 'write_stock', 'write_accounting']::text[]))
);
--> statement-breakpoint
ALTER TABLE "integration_source" ADD CONSTRAINT "integration_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_source_organization_id_idx" ON "integration_source" USING btree ("organization_id");