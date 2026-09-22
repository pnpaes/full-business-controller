CREATE TABLE "adjustment_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opened_from" date NOT NULL,
	"opened_to" date NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "adjustment_period_status_check" CHECK ("adjustment_period"."status" in ('open', 'closed')),
	CONSTRAINT "adjustment_period_range_check" CHECK ("adjustment_period"."opened_to" >= "adjustment_period"."opened_from"),
	CONSTRAINT "adjustment_period_approved_check" CHECK (("adjustment_period"."approved_by" is null and "adjustment_period"."approved_at" is null) or ("adjustment_period"."approved_by" is not null and "adjustment_period"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "adjustment_period" ADD CONSTRAINT "adjustment_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adjustment_period_open_key" ON "adjustment_period" USING btree ("organization_id") WHERE "adjustment_period"."status" = 'open';--> statement-breakpoint
CREATE INDEX "adjustment_period_org_status_idx" ON "adjustment_period" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "adjustment_period_org_opened_idx" ON "adjustment_period" USING btree ("organization_id","opened_from");