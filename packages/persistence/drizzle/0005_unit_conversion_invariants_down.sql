-- Down path for 0005_unit_conversion_invariants.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md). Dropping the constraints removes no
-- table and no row, so no existing data is touched.
ALTER TABLE "unit_conversion" DROP CONSTRAINT IF EXISTS "unit_conversion_version_key";
ALTER TABLE "unit_conversion" DROP CONSTRAINT IF EXISTS "unit_conversion_item_no_overlap";
ALTER TABLE "unit_conversion" DROP CONSTRAINT IF EXISTS "unit_conversion_global_no_overlap";
