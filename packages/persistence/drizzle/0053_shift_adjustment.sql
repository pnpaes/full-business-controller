CREATE TABLE "shift_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shift_assignment_id" uuid NOT NULL,
	"adjusted_hours" numeric(9, 2) NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "shift_adjustment_adjusted_hours_check" CHECK ("shift_adjustment"."adjusted_hours" >= 0),
	CONSTRAINT "shift_adjustment_approved_check" CHECK (("shift_adjustment"."approved_by" is null and "shift_adjustment"."approved_at" is null) or ("shift_adjustment"."approved_by" is not null and "shift_adjustment"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "shift_adjustment" ADD CONSTRAINT "shift_adjustment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_adjustment" ADD CONSTRAINT "shift_adjustment_shift_assignment_id_shift_assignment_id_fk" FOREIGN KEY ("shift_assignment_id") REFERENCES "public"."shift_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_adjustment_org_assignment_idx" ON "shift_adjustment" USING btree ("organization_id","shift_assignment_id");