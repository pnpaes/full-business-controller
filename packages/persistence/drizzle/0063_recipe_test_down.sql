-- Down path for 0063_recipe_test.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-123` append-only recipe-trial table `recipe_test` — its
-- organization FK, its two `recipe_version` NO ACTION FKs, its four checks and
-- its two indexes go with the table — and the additive nullable
-- `recipe_version.method` column. Both drops are **destructive**:
-- `recipe_test` is a fact table, so every recorded trial is lost, and every
-- recorded method/steps value on a version goes with the column. Take a backup
-- or export first if either holds data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0063_recipe_test_down.sql
BEGIN;

DROP TABLE IF EXISTS "recipe_test";

ALTER TABLE "recipe_version" DROP COLUMN IF EXISTS "method";

COMMIT;
