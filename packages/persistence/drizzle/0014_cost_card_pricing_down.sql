-- Down path for 0014_cost_card_pricing.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Reminder: after this down runs, `npm run db:migrate` will SKIP re-applying
-- 0014 until its `drizzle.__drizzle_migrations` row (`created_at =
-- 1789866859108`) is deleted (see the runbook's "Re-applying after a manual
-- down").
--
-- Drops the four slice-7 `price_scenario` columns and the `component_kind`
-- controlled-vocabulary check added with the slice-7 costing work. Destructive:
-- the dropped columns carry data, so re-applying is only safe while that data
-- need not be preserved. Transactional, so a partial down cannot strand the
-- schema between the two tables.
BEGIN;

ALTER TABLE "price_scenario" DROP COLUMN IF EXISTS "target_contribution_pct";
ALTER TABLE "price_scenario" DROP COLUMN IF EXISTS "volume_assumption";
ALTER TABLE "price_scenario" DROP COLUMN IF EXISTS "fee_breakdown";
ALTER TABLE "price_scenario" DROP COLUMN IF EXISTS "outcome";

ALTER TABLE "snapshot_component" DROP CONSTRAINT IF EXISTS "snapshot_component_kind_check";

COMMIT;
