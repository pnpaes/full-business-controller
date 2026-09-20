ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_source_movement_id_stock_movement_id_fk" FOREIGN KEY ("source_movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Hand-written invariants (mirrors 0002_invariants.sql / 0005 / 0007 / 0010 / 0012
-- / 0016). Slice-8 stock ledger (INV-001..003, INV-008) under DEC-008/DEC-009/
-- DEC-010/DEC-028/DEC-034 and ADR-0005.
--
-- Two obligations are closed here:
--
-- 1. `stock_lot.source_movement_id` was deferred (a plain `uuid` in the
--    TypeScript schema) until the receipt slice posted the originating
--    movement; the generated statement above adds that FK now that
--    `stock_movement` is the ledger of record. drizzle-kit emitted it because
--    it is an ordinary FK (see `docs/runbooks/persistence-migrations.md`).
--
-- 2. `stock_movement.source_id` is polymorphic and validated per `source_type`
--    by trigger (the draft's "validated by trigger per slice"; a `CHECK`
--    cannot read another table). Today only `goods_receipt` is modelled, so
--    this trigger asserts, for `source_type = 'goods_receipt'`, that a
--    `goods_receipt` row with that `id` and the same `organization_id` exists
--    and rejects the movement otherwise (the application also guards this, but
--    the ledger must not accept an orphan fact). Every other `source_type`
--    (`production_batch`, `transfer`, `stock_count`, `sales_line`,
--    `waste_event`, `adjustment`, `revaluation`, `correction`) is a documented
--    no-op because those source tables are not modelled yet -- production,
--    sales, transfers and counts are deferred to their own slices, which will
--    extend this trigger. drizzle-kit has no representation for a
--    cross-table trigger, so `source_id` stays a plain `uuid` in the schema.
--
-- The down companion `0017_stock_ledger_invariants_down.sql` drops the trigger
-- and its function and the `stock_lot` FK; like the other down files it is not
-- journaled.
--
-- `stock_movement` is append-only (0002_invariants.sql rejects UPDATE/DELETE/
-- TRUNCATE), so a BEFORE INSERT guard is sufficient: a posted movement's
-- source can never be re-pointed.

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

  -- All other source_types are a deliberate no-op until their slice lands.
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "stock_movement_source_guard"
  BEFORE INSERT ON "stock_movement"
  FOR EACH ROW
  EXECUTE FUNCTION "stock_movement_source_guard"();
