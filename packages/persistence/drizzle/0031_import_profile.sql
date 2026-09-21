CREATE TABLE "import_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"profile_version" text NOT NULL,
	"posting_policy" text DEFAULT 'allow_partial' NOT NULL,
	"validation_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_profile_org_source_key" UNIQUE("organization_id","source"),
	CONSTRAINT "import_profile_posting_policy_check" CHECK ("import_profile"."posting_policy" in ('all_or_nothing', 'allow_partial')),
	CONSTRAINT "import_profile_validation_rules_check" CHECK (jsonb_typeof("import_profile"."validation_rules") = 'object')
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN "import_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "import_profile" ADD CONSTRAINT "import_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_import_profile_id_import_profile_id_fk" FOREIGN KEY ("import_profile_id") REFERENCES "public"."import_profile"("id") ON DELETE no action ON UPDATE no action;