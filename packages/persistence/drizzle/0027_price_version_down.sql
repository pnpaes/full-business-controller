-- Down path for 0027_price_version.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the hand-written `price_version_no_overlap` EXCLUDE constraint and then
-- the `price_version` table inside one transaction. The constraint is dropped
-- explicitly first (rather than relying on the table drop) so a plain
-- `DROP TABLE` is the only remaining step and any constraint-drop failure
-- surfaces on its own; the index `price_version_scope_idx` and the FKs/checks
-- are dropped with the table. This is **destructive**: any approved, effective
-- price versions are lost, so it is only safe while that price history carries
-- nothing that must be preserved (financial/stock facts are append-only,
-- AGENTS.md Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0027_price_version_down.sql
BEGIN;

ALTER TABLE "price_version"
  DROP CONSTRAINT IF EXISTS "price_version_no_overlap";
DROP TABLE IF EXISTS "price_version";

COMMIT;
