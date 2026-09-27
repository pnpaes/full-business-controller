-- Down path for 0077_user_invite.sql. Not listed in meta/_journal.json on
-- purpose: `drizzle-kit migrate` only applies journal entries, so a rollback is
-- an explicit operator action (see docs/runbooks/persistence-migrations.md,
-- "Down migrations").
--
-- Drops the hand-written org guard, then the `user_invite` table, then the two
-- nullable `app_user` columns added by the expand. Destructive only to
-- outstanding/past invite rows and the `app_user.invited_*` provenance: no
-- posted money, stock or other business fact is touched, and `app_user` rows,
-- `auth_session` and `password_reset_token` are left intact. Take a backup
-- before running it (AGENTS.md Rule 2). Apply it manually with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0077_user_invite_down.sql
BEGIN;

DROP TRIGGER IF EXISTS "user_invite_user_org_guard" ON "user_invite";
DROP FUNCTION IF EXISTS "user_invite_user_org_guard"();

DROP TABLE IF EXISTS "user_invite";

ALTER TABLE "app_user" DROP COLUMN IF EXISTS "invited_at";
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "invited_by";

COMMIT;
