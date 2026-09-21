CREATE TABLE "import_disposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_staging_row_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"reason" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "import_disposition_staging_row_key" UNIQUE("import_staging_row_id"),
	CONSTRAINT "import_disposition_disposition_check" CHECK ("import_disposition"."disposition" in ('unmapped', 'rejected', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "import_disposition" ADD CONSTRAINT "import_disposition_import_staging_row_id_import_staging_row_id_fk" FOREIGN KEY ("import_staging_row_id") REFERENCES "public"."import_staging_row"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `DEC-083` backfill: move the pre-existing approved dispositions out of
-- `import_run.diagnostics.dispositions` jsonb. The jsonb keys are retained
-- frozen (expand → migrate → contract). The latest record per staging row wins,
-- so the one-disposition-per-row unique key holds. Rows with a malformed
-- uuid/vocabulary, or whose staging row no longer exists, are skipped (the
-- runbook preflight reports them). A malformed `at`, though, is NOT skipped:
-- its cast aborts the migration, so run the runbook preflight first (it now
-- flags those records too).
INSERT INTO "import_disposition" ("import_staging_row_id", "disposition", "reason", "actor_id", "created_at")
SELECT
  (latest.element ->> 'stagingRowId')::uuid,
  latest.element ->> 'disposition',
  latest.element ->> 'reason',
  (latest.element ->> 'actorId')::uuid,
  COALESCE((latest.element ->> 'at')::timestamptz, now())
FROM (
  SELECT DISTINCT ON (element ->> 'stagingRowId') element
  FROM "import_run"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE("diagnostics" -> 'dispositions', '[]'::jsonb)) AS element
  WHERE element ->> 'stagingRowId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND element ->> 'actorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND element ->> 'disposition' IN ('unmapped', 'rejected', 'ignored')
  ORDER BY element ->> 'stagingRowId', (element ->> 'at')::timestamptz DESC NULLS LAST
) AS latest
WHERE EXISTS (
  SELECT 1 FROM "import_staging_row" r WHERE r."id" = (latest.element ->> 'stagingRowId')::uuid
);