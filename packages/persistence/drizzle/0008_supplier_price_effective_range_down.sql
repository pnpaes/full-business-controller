-- Down path for 0008_supplier_price_effective_range.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the original strict `effective_to > effective_from` check. This
-- VALIDATES existing rows, so it fails if any degenerate
-- `[effective_from, effective_from)` windows exist (the empty windows 0008
-- permits); close or remove them before running the down.
ALTER TABLE "supplier_price" DROP CONSTRAINT IF EXISTS "supplier_price_effective_range_check";
ALTER TABLE "supplier_price" ADD CONSTRAINT "supplier_price_effective_range_check"
  CHECK ("supplier_price"."effective_to" is null or "supplier_price"."effective_to" > "supplier_price"."effective_from");
