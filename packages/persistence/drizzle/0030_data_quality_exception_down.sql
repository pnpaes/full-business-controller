-- Down path for 0030_data_quality_exception.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-080` (`DQ-001`) `data_quality_exception` table inside one
-- transaction, with `DROP TABLE IF EXISTS` so a half-applied manual run cannot
-- wedge. Its checks, the organization FK and the two indexes
-- (`data_quality_exception_org_status_idx`,
-- `data_quality_exception_org_entity_idx`) drop with the table. This is
-- **destructive**: every recorded data-quality exception is lost, including the
-- `transfer_discrepancy` rows the transfer receive command writes alongside
-- `stock_transfer.discrepancy_note`, so run it only while those exceptions need
-- not be preserved (AGENTS.md Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0030_data_quality_exception_down.sql
BEGIN;

DROP TABLE IF EXISTS "data_quality_exception";

COMMIT;
