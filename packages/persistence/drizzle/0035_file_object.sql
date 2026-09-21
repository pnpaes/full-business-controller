CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"retention_policy" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_entity_type" text,
	"linked_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "file_object_org_storage_key_key" UNIQUE("organization_id","storage_key"),
	CONSTRAINT "file_object_size_bytes_check" CHECK ("file_object"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Hand-edited (the runbook's deferred-FK pattern, `0029_org_coherence_guards.sql`
-- style): `import_run.file_object_id` may already hold values while
-- `file_object` starts empty, so the FK is added `NOT VALID` (metadata-only,
-- still enforced for new writes) and then validated in the same transaction.
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "import_run" VALIDATE CONSTRAINT "import_run_file_object_id_file_object_id_fk";