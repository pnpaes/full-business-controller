-- Down path for 0079_item_purpose.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md,
-- "Down migrations").
--
-- Drops the `DEC-150` edge guard (trigger + function), then the purpose index,
-- then the `item.purpose` column. The column drop is **destructive** to the
-- stored purpose: a revert re-arms the pre-`DEC-150` behaviour where purpose is
-- not stored at all and `item_type` is the only signal, so any re-classification
-- an operator made after the up apply is lost. No item row, no other column and
-- no other constraint is touched. Take a backup before running it (AGENTS.md
-- Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0079_item_purpose_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "product_variant_finished_good_purpose_guard" ON "product_variant";
DROP FUNCTION IF EXISTS "product_variant_finished_good_purpose_guard"();

DROP INDEX IF EXISTS "item_organization_id_purpose_idx";
ALTER TABLE "item" DROP COLUMN IF EXISTS "purpose";

COMMIT;
