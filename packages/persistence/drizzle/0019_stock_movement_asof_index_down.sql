-- Down path for 0019_stock_movement_asof_index.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops `stock_movement_org_occurred_idx`, the as-of aggregation index added by
-- 0019. No table and no row is touched, so it is safe to run whenever the index
-- must be removed (for example before a data repair); dropping it only makes
-- `sumStockMovementsAsOf` fall back to a sequential scan. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0019_stock_movement_asof_index_down.sql
BEGIN;

DROP INDEX IF EXISTS "stock_movement_org_occurred_idx";

COMMIT;
