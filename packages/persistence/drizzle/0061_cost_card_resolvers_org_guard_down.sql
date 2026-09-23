-- Down path for 0061_cost_card_resolvers_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-112` cross-organization coherence guards: the
-- `recipe_version_labor_cost_center_org_guard` and
-- `operating_cost_cost_pool_org_guard` triggers and their functions. No table
-- and no row is touched, so it is safe to run whenever the cross-organization
-- invariant must be removed (for example before a data repair). While dropped,
-- the organization coherence of a recipe version's `labor_cost_center_id` and an
-- operating cost's `cost_pool_id` is validated only by the application until the
-- migration is re-applied. Apply `0061`'s org-guard down **before**
-- `0060_cost_card_resolvers_down.sql`, because its triggers live on the columns
-- that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0061_cost_card_resolvers_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "operating_cost_cost_pool_org_guard" ON "operating_cost";
DROP TRIGGER IF EXISTS "recipe_version_labor_cost_center_org_guard" ON "recipe_version";
DROP FUNCTION IF EXISTS "operating_cost_cost_pool_org_guard"();
DROP FUNCTION IF EXISTS "recipe_version_labor_cost_center_org_guard"();

COMMIT;
