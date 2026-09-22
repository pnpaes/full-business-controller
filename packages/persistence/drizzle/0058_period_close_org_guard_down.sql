-- Down path for 0058_period_close_org_guard.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `REC-003`/`REC-006`/`DEC-027` (row 13a) `period_close` guards: the
-- scope-coherence trigger, the locked-snapshot immutability trigger and the
-- locked-row delete guard, plus their functions. No table and no row is touched,
-- so it is safe to run whenever the invariants must be removed (for example
-- before a data repair). While dropped, a location scope's organization
-- coherence, the locked-snapshot immutability and the locked-delete block are
-- validated only by the application until the migration is re-applied. Apply
-- `0058`'s down **before** `0057_period_close_down.sql`, because its triggers
-- live on the table that down drops.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0058_period_close_org_guard_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "period_close_scope_org_guard" ON "period_close";
DROP FUNCTION IF EXISTS "period_close_scope_org_guard"();
DROP TRIGGER IF EXISTS "period_close_locked_immutability" ON "period_close";
DROP FUNCTION IF EXISTS "period_close_locked_immutability"();
DROP TRIGGER IF EXISTS "period_close_locked_delete_guard" ON "period_close";
DROP FUNCTION IF EXISTS "period_close_locked_delete_guard"();

COMMIT;
