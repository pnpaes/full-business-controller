-- Down path for 0009_recipe_allergens.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- These are the two slice-5 allergen tables only: dropping them drops their
-- constraints, indexes and FKs with them. `recipe_allergen` is dropped before
-- `allergen` because it references it. No existing table is touched, so no
-- pre-existing data is removed. `IF EXISTS` + a single transaction make a
-- half-applied manual run idempotent instead of wedging on a missing table.
-- The recipe tables the allergen declarations point at (`recipe`,
-- `recipe_version`, `recipe_line`) were created by the 0001 core and are left
-- untouched.
BEGIN;
DROP TABLE IF EXISTS "recipe_allergen";
DROP TABLE IF EXISTS "allergen";
COMMIT;
