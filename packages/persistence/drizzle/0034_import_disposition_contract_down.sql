-- Down path for 0034_import_disposition_contract.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Inverse of the contract: rebuild each run's `diagnostics.dispositions` from
-- `import_disposition` (the source of truth after `0033`) without dropping the
-- table. Lossless with respect to the table; value-identical, not
-- order-identical (ordered by `source_row_no`). A run with no dispositions in
-- the table keeps no `dispositions` key.
BEGIN;
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
COMMIT;
