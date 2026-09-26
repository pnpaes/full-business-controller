CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"outbox_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('pending', 'running', 'succeeded', 'failed', 'dead_lettered')),
	CONSTRAINT "job_attempts_non_negative_check" CHECK ("job"."attempts" >= 0 and "job"."max_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_org_status_scheduled_idx" ON "job" USING btree ("organization_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_org_outbox_event_idx" ON "job" USING btree ("organization_id","outbox_event_id");