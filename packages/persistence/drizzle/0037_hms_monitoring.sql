CREATE TABLE "monitoring_point" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"storage_area_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"target_min" numeric(19, 6) NOT NULL,
	"target_max" numeric(19, 6) NOT NULL,
	"check_frequency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "monitoring_point_organization_id_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "monitoring_point_kind_check" CHECK ("monitoring_point"."kind" in ('refrigerator', 'freezer', 'cooler', 'hot_holding', 'other')),
	CONSTRAINT "monitoring_point_check_frequency_check" CHECK ("monitoring_point"."check_frequency" in ('daily', 'twice_daily', 'weekly', 'monthly', 'other')),
	CONSTRAINT "monitoring_point_target_range_check" CHECK ("monitoring_point"."target_min" <= "monitoring_point"."target_max")
);
--> statement-breakpoint
CREATE TABLE "monitoring_reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"monitoring_point_id" uuid NOT NULL,
	"value" numeric(19, 6) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"in_range" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_point" ADD CONSTRAINT "monitoring_point_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_point" ADD CONSTRAINT "monitoring_point_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_point" ADD CONSTRAINT "monitoring_point_storage_area_id_storage_area_id_fk" FOREIGN KEY ("storage_area_id") REFERENCES "public"."storage_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_reading" ADD CONSTRAINT "monitoring_reading_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_reading" ADD CONSTRAINT "monitoring_reading_monitoring_point_id_monitoring_point_id_fk" FOREIGN KEY ("monitoring_point_id") REFERENCES "public"."monitoring_point"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_reading_org_point_measured_idx" ON "monitoring_reading" USING btree ("organization_id","monitoring_point_id","measured_at");