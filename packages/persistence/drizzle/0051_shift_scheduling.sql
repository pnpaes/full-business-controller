CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"role_code" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"published_at" timestamp with time zone,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "shift_state_check" CHECK ("shift"."state" in ('open', 'published', 'assigned', 'cancelled', 'completed')),
	CONSTRAINT "shift_time_range_check" CHECK ("shift"."ends_at" > "shift"."starts_at"),
	CONSTRAINT "shift_break_minutes_check" CHECK ("shift"."break_minutes" >= 0),
	CONSTRAINT "shift_actual_range_check" CHECK ("shift"."actual_end" is null or "shift"."actual_start" is null or "shift"."actual_end" > "shift"."actual_start")
);
--> statement-breakpoint
CREATE TABLE "shift_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"state" text NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "shift_assignment_shift_employee_key" UNIQUE("shift_id","employee_id"),
	CONSTRAINT "shift_assignment_state_check" CHECK ("shift_assignment"."state" in ('self_assigned', 'pending_approval', 'approved', 'withdrawn', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_org_location_starts_idx" ON "shift" USING btree ("organization_id","location_id","starts_at");--> statement-breakpoint
CREATE INDEX "shift_org_state_idx" ON "shift" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "shift_assignment_org_shift_idx" ON "shift_assignment" USING btree ("organization_id","shift_id");--> statement-breakpoint
CREATE INDEX "shift_assignment_org_employee_idx" ON "shift_assignment" USING btree ("organization_id","employee_id");