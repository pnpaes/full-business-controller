-- Down path for 0071_job.sql. Not listed in meta/_journal.json on purpose:
-- `drizzle-kit migrate` only applies journal entries, so a rollback is an
-- explicit operator action (see docs/runbooks/persistence-migrations.md,
-- "Down migrations").
--
-- Drops the `job` application job-projection table (its checks, indexes and the
-- `organization_id` FK go with it). The `outbox_event` table is **not** touched:
-- it is the durable source of truth (`ADR-0004` shape P2), predates this
-- migration and still belongs to the platform core. Because the runner queue
-- (pg-boss) is disposable and rebuildable by replaying unpublished outbox rows,
-- dropping only the projection loses progress state, not a financial or stock
-- fact; take a backup before running the drop (AGENTS.md Rule 2). Apply it
-- manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0071_job_down.sql
--
-- Rehearsed 2026-09-26 on a scratch database (never the dev database): created,
-- migration 0071 applied alongside the rest, the `job` table confirmed present,
-- this down applied, the `job` table confirmed absent, scratch database dropped.
BEGIN;

DROP TABLE IF EXISTS "job";

COMMIT;
