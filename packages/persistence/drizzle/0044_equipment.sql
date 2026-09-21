CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"serial_no" text,
	"installed_at" date,
	"warranty_until" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "equipment_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "equipment_code_nonempty_check" CHECK (length(btrim("equipment"."code")) > 0),
	CONSTRAINT "equipment_name_nonempty_check" CHECK (length(btrim("equipment"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" uuid NOT NULL,
	"notes" text,
	"file_object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "maintenance_log_kind_check" CHECK ("maintenance_log"."kind" in ('service', 'repair', 'inspection'))
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_log" ADD CONSTRAINT "maintenance_log_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_org_location_idx" ON "equipment" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE INDEX "equipment_org_active_idx" ON "equipment" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "maintenance_log_org_equipment_performed_idx" ON "maintenance_log" USING btree ("organization_id","equipment_id","performed_at");--> statement-breakpoint
CREATE INDEX "maintenance_log_org_kind_idx" ON "maintenance_log" USING btree ("organization_id","kind");