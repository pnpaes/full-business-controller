CREATE TABLE "external_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"sku" text,
	"internal_entity_type" text NOT NULL,
	"internal_entity_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "external_mapping_key" UNIQUE("source_system","entity_type","external_id","effective_from"),
	CONSTRAINT "external_mapping_effective_range_check" CHECK ("external_mapping"."effective_to" is null or "external_mapping"."effective_to" > "external_mapping"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"profile_version" text NOT NULL,
	"file_object_id" uuid,
	"file_hash" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"row_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_run_file_hash_key" UNIQUE("file_hash"),
	CONSTRAINT "import_run_status_check" CHECK ("import_run"."status" in ('uploaded', 'parsed', 'needs_review', 'validated', 'posted', 'partially_posted', 'failed', 'superseded')),
	CONSTRAINT "import_run_period_check" CHECK ("import_run"."period_end" >= "import_run"."period_start")
);
--> statement-breakpoint
CREATE TABLE "import_staging_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"source_row_no" integer NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping_state" text DEFAULT 'unmapped' NOT NULL,
	"error_code" text,
	"linked_sales_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_staging_row_run_row_no_key" UNIQUE("import_run_id","source_row_no"),
	CONSTRAINT "import_staging_row_mapping_state_check" CHECK ("import_staging_row"."mapping_state" in ('unmapped', 'mapped', 'ignored', 'error'))
);
--> statement-breakpoint
ALTER TABLE "external_mapping" ADD CONSTRAINT "external_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_row" ADD CONSTRAINT "import_staging_row_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_run_org_source_idx" ON "import_run" USING btree ("organization_id","source");--> statement-breakpoint
CREATE INDEX "import_run_org_status_idx" ON "import_run" USING btree ("organization_id","status");