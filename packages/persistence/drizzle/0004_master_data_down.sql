-- Down path for 0004_master_data.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- These are the four slice-3 master-data tables only: dropping them drops their
-- constraints, indexes and FKs with them. `supplier_item` is dropped before
-- `supplier` because it references it. No existing table is touched, so no
-- pre-existing data is removed.
DROP TABLE "supplier_item";
DROP TABLE "supplier";
DROP TABLE "unit_conversion";
DROP TABLE "cost_center";
