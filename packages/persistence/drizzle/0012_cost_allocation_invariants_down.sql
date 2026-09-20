-- Down path for 0012_cost_allocation_invariants.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md). Dropping the constraints removes no
-- table and no row, so no existing data is touched.
ALTER TABLE "cost_pool" DROP CONSTRAINT IF EXISTS "cost_pool_no_overlap";
ALTER TABLE "labor_rate" DROP CONSTRAINT IF EXISTS "labor_rate_no_overlap";
ALTER TABLE "allocation_rule" DROP CONSTRAINT IF EXISTS "allocation_rule_no_overlap";
