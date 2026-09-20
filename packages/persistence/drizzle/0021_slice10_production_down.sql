-- Down path for 0021_slice10_production.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the four slice-10 production tables (`production_batch_input`,
-- `production_batch_output`, `production_batch`, `production_plan`), the
-- `waste_event.production_batch_id` FK and restores the `0020` body of
-- `stock_movement_source_guard` so `source_type = 'production_batch'` falls back
-- to a no-op (the other branches are kept). This is **destructive**: any plan,
-- batch or batch-line rows are lost, so it is only safe while those tables carry
-- nothing that must be preserved. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0021_slice10_production_down.sql
BEGIN;

-- 1. Restore the pre-0021 guard (the 0020 body) before the production_batch
--    table it now references is dropped, so the trigger never points at a
--    missing table.
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
  ELSIF NEW."source_type" = 'stock_count' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "stock_count"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a stock_count in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'transfer' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "stock_transfer"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a stock_transfer in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW."source_type" = 'waste_event' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "waste_event"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a waste_event in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Drop the deferred waste_event FK (the column itself is kept: it was added
--    by 0020).
ALTER TABLE "waste_event" DROP CONSTRAINT IF EXISTS "waste_event_production_batch_id_production_batch_id_fk";

-- 3. Drop the slice-10 tables in FK-safe order (batch-line children first, then
--    the batch — whose self-FK and plan FK drop with it — then the plan).
DROP TABLE IF EXISTS "production_batch_input";
DROP TABLE IF EXISTS "production_batch_output";
DROP TABLE IF EXISTS "production_batch";
DROP TABLE IF EXISTS "production_plan";

COMMIT;
