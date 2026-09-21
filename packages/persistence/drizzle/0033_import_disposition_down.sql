-- Down path for 0033_import_disposition.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Reverses `DEC-083` inside one transaction. The application writes only the
-- `import_disposition` table after the migration, so the jsonb is rebuilt from
-- the table before it is dropped: the rollback is lossless (each run's
-- `diagnostics.dispositions` is restored in `source_row_no` order, with the
-- same keys the pre-migration jsonb held). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0033_import_disposition_down.sql
BEGIN;
-- `DEC-083` down: rebuild `import_run.diagnostics.dispositions` from the table
-- (the application writes only the table after the migration), then drop the
-- table. The rebuild makes the rollback lossless.
UPDATE "import_run" SET "diagnostics" = jsonb_set(
  COALESCE("diagnostics", '{}'::jsonb),
  '{dispositions}',
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'stagingRowId', r."id",
      'sourceRowNo', r."source_row_no",
      'disposition', d."disposition",
      'reason', d."reason",
      'actorId', d."actor_id",
      'at', to_char(d."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY r."source_row_no")
    FROM "import_disposition" d
    JOIN "import_staging_row" r ON r."id" = d."import_staging_row_id"
    WHERE r."import_run_id" = "import_run"."id"
  ), '[]'::jsonb),
  true
)
WHERE EXISTS (
  SELECT 1 FROM "import_staging_row" r
  JOIN "import_disposition" d ON d."import_staging_row_id" = r."id"
  WHERE r."import_run_id" = "import_run"."id"
);
DROP TABLE IF EXISTS "import_disposition";
COMMIT;
