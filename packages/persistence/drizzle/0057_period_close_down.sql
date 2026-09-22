-- Down path for 0057_period_close.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md).
--
-- Drops the `REC-003`/`REC-006`/`DEC-027` (row 13a) close/lock table
-- `period_close`. Its organization FK, its
-- `(organization_id, scope_type, scope_id, period_start)` unique, its checks and
-- its two indexes go with the table; the scope-coherence guard and the
-- locked-snapshot immutability/delete triggers are dropped by the companion
-- `0058_period_close_org_guard_down.sql`, which must be applied **before** this
-- file. `DROP TABLE` drops the table's triggers but **not** the trigger
-- functions, so applying `0058`'s down first also drops the three functions;
-- skipping it leaves the functions behind (harmless but untidy). This is
-- **destructive**: every close row (and its frozen snapshot) is lost, so take a
-- backup or export first if the table holds data.
-- Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0057_period_close_down.sql
BEGIN;

DROP TABLE IF EXISTS "period_close";

COMMIT;
