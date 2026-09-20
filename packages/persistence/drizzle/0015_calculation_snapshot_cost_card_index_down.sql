-- Down path for 0015_calculation_snapshot_cost_card_index.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the index only; no table and no row, so it is safe to run whenever the
-- snapshot read-path index must be removed (for example before a data repair).
BEGIN;

DROP INDEX IF EXISTS "calculation_snapshot_cost_card_idx";

COMMIT;
