CREATE TABLE "competitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_organization_id_name_key" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "competitor_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"item_id" uuid,
	"external_name" text NOT NULL,
	"price" numeric(19, 4),
	"currency" char(3),
	"offer_notes" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_observation_review_status_check" CHECK ("competitor_observation"."review_status" in ('pending', 'reviewed', 'rejected')),
	CONSTRAINT "competitor_observation_price_check" CHECK ("competitor_observation"."price" is null or "competitor_observation"."price" >= 0),
	CONSTRAINT "competitor_observation_review_gate_check" CHECK ("competitor_observation"."review_status" = 'pending' or ("competitor_observation"."reviewed_by" is not null and "competitor_observation"."reviewed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD CONSTRAINT "competitor_observation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD CONSTRAINT "competitor_observation_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_observation" ADD CONSTRAINT "competitor_observation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_observation_org_observed_idx" ON "competitor_observation" USING btree ("organization_id","observed_at");--> statement-breakpoint
CREATE INDEX "competitor_observation_competitor_observed_idx" ON "competitor_observation" USING btree ("competitor_id","observed_at");