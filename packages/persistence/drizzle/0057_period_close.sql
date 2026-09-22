CREATE TABLE "period_close" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb,
	"correction_policy" text,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "period_close_org_scope_period_key" UNIQUE("organization_id","scope_type","scope_id","period_start"),
	CONSTRAINT "period_close_status_check" CHECK ("period_close"."status" in ('open', 'closing', 'locked', 'reopened')),
	CONSTRAINT "period_close_scope_type_check" CHECK ("period_close"."scope_type" in ('location', 'company')),
	CONSTRAINT "period_close_period_range_check" CHECK ("period_close"."period_end" >= "period_close"."period_start"),
	CONSTRAINT "period_close_granularity_check" CHECK (("period_close"."scope_type" = 'location' and "period_close"."period_start" = "period_close"."period_end") or ("period_close"."scope_type" = 'company' and "period_close"."period_start" = date_trunc('month', "period_close"."period_start")::date and "period_close"."period_end" = (date_trunc('month', "period_close"."period_start") + interval '1 month' - interval '1 day')::date)),
	CONSTRAINT "period_close_locked_check" CHECK (("period_close"."locked_by" is null and "period_close"."locked_at" is null) or ("period_close"."locked_by" is not null and "period_close"."locked_at" is not null)),
	CONSTRAINT "period_close_reopened_check" CHECK ("period_close"."status" <> 'reopened' or ("period_close"."reopened_by" is not null and "period_close"."reopened_at" is not null and "period_close"."reopen_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "period_close" ADD CONSTRAINT "period_close_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_close_org_scope_idx" ON "period_close" USING btree ("organization_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "period_close_org_status_idx" ON "period_close" USING btree ("organization_id","status");