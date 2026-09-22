CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_decision_check" CHECK ("approval"."decision" in ('approved', 'rejected')),
	CONSTRAINT "approval_decided_check" CHECK (("approval"."decided_by" is null and "approval"."decided_at" is null and "approval"."decision" is null) or ("approval"."decided_by" is not null and "approval"."decided_at" is not null and "approval"."decision" is not null))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"linked_entity_type" text,
	"linked_entity_id" uuid,
	"owner_id" uuid,
	"due_date" date,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_from_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_status_check" CHECK ("task"."status" in ('open', 'in_progress', 'blocked', 'resolved', 'dismissed')),
	CONSTRAINT "task_linked_entity_check" CHECK (("task"."linked_entity_type" is null) = ("task"."linked_entity_id" is null))
);
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_org_entity_idx" ON "approval" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approval_org_decision_idx" ON "approval" USING btree ("organization_id","decision");--> statement-breakpoint
CREATE INDEX "task_org_status_idx" ON "task" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "task_org_owner_due_idx" ON "task" USING btree ("organization_id","owner_id","due_date");--> statement-breakpoint
CREATE INDEX "task_org_linked_idx" ON "task" USING btree ("organization_id","linked_entity_type","linked_entity_id");