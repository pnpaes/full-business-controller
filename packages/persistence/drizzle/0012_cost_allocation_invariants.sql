-- Hand-written invariants (mirrors 0002_invariants.sql / 0005 / 0010). Slice-6
-- costing/COST-007 review fix. `cost_pool`, `labor_rate` and `allocation_rule`
-- are effective-dated financial inputs (DATA_DICTIONARY §0), so each needs an
-- exclusion constraint on its version key -- the FND-004 rule that drizzle-kit
-- cannot express. These are emitted here rather than in the generated
-- `0011_cost_allocation.sql` because drizzle-kit has no representation for
-- `EXCLUDE USING gist`: the columns are plain `date`/`uuid`/`text` in the
-- TypeScript schema, so `generate` never sees or fights these constraints
-- (hand-written invariants convention: see docs/runbooks/persistence-migrations.md).
--
-- `btree_gist` is already enabled in `0000_enable_extensions.sql`; the `=`
-- operators on `uuid`/`text` in an EXCLUDE constraint require it.
--
-- `operating_cost` deliberately has **no** overlap exclusion: two concurrent
-- overheads in one cost centre and period are legitimate (rent and insurance
-- share a window), so an exclusion there would be wrong. Rates and pools are
-- versioned and therefore exclusive; operating costs are additive facts.

-- 1. No two effective rows may cover the same (organization, pool code).
ALTER TABLE "cost_pool" ADD CONSTRAINT "cost_pool_no_overlap"
  EXCLUDE USING gist ("organization_id" WITH =, "code" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);

-- 2. No two effective rows may cover the same (organization, cost centre, role).
ALTER TABLE "labor_rate" ADD CONSTRAINT "labor_rate_no_overlap"
  EXCLUDE USING gist ("organization_id" WITH =, "cost_center_id" WITH =, "role_code" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);

-- 3. No two effective rows may cover the same pool. `allocation_rule` carries no
--    own `organization_id`; it is scoped through `cost_pool`, so the pool id is
--    the whole version key.
ALTER TABLE "allocation_rule" ADD CONSTRAINT "allocation_rule_no_overlap"
  EXCLUDE USING gist ("cost_pool_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);
