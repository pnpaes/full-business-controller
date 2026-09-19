-- Down path for 0004_master_data.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- These are the four slice-3 master-data tables only: dropping them drops their
-- constraints, indexes and FKs with them. `supplier_item` is dropped before
-- `supplier` because it references it. No existing table is touched, so no
-- pre-existing data is removed. `IF EXISTS` + a single transaction make a
-- half-applied manual run idempotent instead of wedging on a missing table.
-- Apply 0005's down first if 0005 was applied: its constraints live on
-- `unit_conversion`, which this file drops.
BEGIN;
DROP TABLE IF EXISTS "supplier_item";
DROP TABLE IF EXISTS "supplier";
DROP TABLE IF EXISTS "unit_conversion";
DROP TABLE IF EXISTS "cost_center";
COMMIT;
