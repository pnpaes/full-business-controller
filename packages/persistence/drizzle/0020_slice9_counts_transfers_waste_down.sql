-- Down path for 0020_slice9_counts_transfers_waste.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the four slice-9 tables (`waste_event`, `stock_count_line`,
-- `stock_count`, `stock_transfer`) and the `stock_movement.transfer_id` column
-- (with its FK and partial index), and restores the `0017` body of
-- `stock_movement_source_guard` so source_type validation falls back to the
-- goods_receipt-only behaviour. This is **destructive**: any count, transfer or
-- waste rows are lost, so it is only safe while those tables carry nothing that
-- must be preserved. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0020_slice9_counts_transfers_waste_down.sql
BEGIN;

-- 1. Restore the pre-0020 guard (the 0017 body) before the slice-9 tables it
--    now references are dropped, so the trigger never points at a missing table.
CREATE OR REPLACE FUNCTION "stock_movement_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_type" = 'goods_receipt' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "goods_receipt"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a goods_receipt in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Unwind the `stock_movement.transfer_id` addition (the partial index
--    `stock_movement_transfer_idx` drops with the column).
ALTER TABLE "stock_movement" DROP CONSTRAINT IF EXISTS "stock_movement_transfer_id_stock_transfer_id_fk";
ALTER TABLE "stock_movement" DROP COLUMN IF EXISTS "transfer_id";

-- 3. Drop the slice-9 tables in FK-safe order.
DROP TABLE IF EXISTS "waste_event";
DROP TABLE IF EXISTS "stock_count_line";
DROP TABLE IF EXISTS "stock_count";
DROP TABLE IF EXISTS "stock_transfer";

COMMIT;
