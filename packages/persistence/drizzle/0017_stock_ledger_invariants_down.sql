-- Down path for 0017_stock_ledger_invariants.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the two hand-written invariants and the generated `stock_lot` FK. No
-- table and no row is touched, so it is safe to run whenever the slice-8 stock
-- invariants must be removed (for example before a data repair). Once the raw
-- objects are dropped, `stock_movement.source_id` is validated only by the
-- application and the `stock_lot` link is unenforced until the migration is
-- re-applied.
BEGIN;

DROP TRIGGER IF EXISTS "stock_movement_source_guard" ON "stock_movement";
DROP FUNCTION IF EXISTS "stock_movement_source_guard"();
ALTER TABLE "stock_lot" DROP CONSTRAINT IF EXISTS "stock_lot_source_movement_id_stock_movement_id_fk";

COMMIT;
