-- Down path for 0016_cost_card_approved_scope.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the partial unique index only; no table and no row, so it is safe to
-- run whenever the DEC-060 approved-scope invariant must be removed (for
-- example before a data repair). The application-level supersede rule in
-- `approveCostCard` remains the only guard while it is dropped.
BEGIN;

DROP INDEX IF EXISTS "cost_card_approved_scope_key";

COMMIT;
