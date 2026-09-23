-- Down path for 0060_cost_card_resolvers.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-112` cost-card component-resolver schema facts:
--   * `recipe_version.labor_cost_center_id` / `labor_role_code` (the per-version
--     direct-labour mapping) with their FK, both checks and the
--     `recipe_version_labor_idx` index;
--   * `operating_cost.cost_pool_id` (the shared-pool link) with its FK and the
--     `operating_cost_pool_idx` index.
-- This is **destructive**: every labour mapping and every cost-pool link is lost,
-- so take a backup or export first if the columns hold data. Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0060_cost_card_resolvers_down.sql
BEGIN;

DROP INDEX IF EXISTS "recipe_version_labor_idx";
DROP INDEX IF EXISTS "operating_cost_pool_idx";

ALTER TABLE "recipe_version" DROP CONSTRAINT IF EXISTS "recipe_version_labor_role_code_check";
ALTER TABLE "recipe_version" DROP CONSTRAINT IF EXISTS "recipe_version_labor_mapping_check";
ALTER TABLE "recipe_version" DROP CONSTRAINT IF EXISTS "recipe_version_labor_cost_center_id_cost_center_id_fk";
ALTER TABLE "operating_cost" DROP CONSTRAINT IF EXISTS "operating_cost_cost_pool_id_cost_pool_id_fk";

ALTER TABLE "recipe_version" DROP COLUMN IF EXISTS "labor_cost_center_id";
ALTER TABLE "recipe_version" DROP COLUMN IF EXISTS "labor_role_code";
ALTER TABLE "operating_cost" DROP COLUMN IF EXISTS "cost_pool_id";

COMMIT;
