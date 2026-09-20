-- Down path for 0023_row12_sales_settlements_reconciliation.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the `0021` `stock_movement_source_guard` body (drops the `sales_line`
-- branch) and drops the four row-12 tables (`sales_line`, `sales_transaction`,
-- `settlement`, `reconciliation`) inside one transaction, in FK-safe order
-- (`sales_line` before its `sales_transaction` parent). This is **destructive**:
-- any sales-line/transaction, settlement or reconciliation rows are lost, so it
-- is only safe while those tables carry nothing that must be preserved. Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0023_row12_sales_settlements_reconciliation_down.sql
--
-- The `waste_event.production_batch_id` FK added in `0021` is untouched (the
-- `production_batch` table stays).
BEGIN;

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
  ELSIF NEW."source_type" = 'production_batch' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "production_batch"
      WHERE "id" = NEW."source_id"
        AND "organization_id" = NEW."organization_id"
    ) THEN
      RAISE EXCEPTION
        'stock_movement.source_id % is not a production_batch in organization % (source_type=%)',
        NEW."source_id", NEW."organization_id", NEW."source_type"
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- All other source_types are a deliberate no-op until their slice lands.
  RETURN NEW;
END;
$$;

DROP TABLE IF EXISTS "sales_line";
DROP TABLE IF EXISTS "sales_transaction";
DROP TABLE IF EXISTS "settlement";
DROP TABLE IF EXISTS "reconciliation";

COMMIT;
