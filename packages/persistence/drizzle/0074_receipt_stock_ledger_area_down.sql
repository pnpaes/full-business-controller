-- Down path for 0074_receipt_stock_ledger_area.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the DEC-145 coherence guards (the location default-area guard, the
-- receipt storage-area guard and their functions) and then the two expand-only
-- columns `location.default_storage_area_id` and `goods_receipt.storage_area_id`
-- with their foreign keys. The two columns are nullable and carry no data of
-- their own beyond the configured default / override, so dropping them loses
-- that configuration only; no `stock_movement` or other ledger row is touched.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0074_receipt_stock_ledger_area_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "location_default_storage_area_guard" ON "location";
DROP FUNCTION IF EXISTS "location_default_storage_area_guard"();
DROP TRIGGER IF EXISTS "goods_receipt_storage_area_guard" ON "goods_receipt";
DROP FUNCTION IF EXISTS "goods_receipt_storage_area_guard"();

ALTER TABLE "location" DROP CONSTRAINT IF EXISTS "location_default_storage_area_id_storage_area_id_fk";
ALTER TABLE "location" DROP COLUMN IF EXISTS "default_storage_area_id";
ALTER TABLE "goods_receipt" DROP CONSTRAINT IF EXISTS "goods_receipt_storage_area_id_storage_area_id_fk";
ALTER TABLE "goods_receipt" DROP COLUMN IF EXISTS "storage_area_id";

COMMIT;
