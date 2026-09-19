-- Down path for 0003_user_totp_last_used_counter.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (or a manual replay of
-- the bootstrap recovery). The check constraint drops with the column.
ALTER TABLE "user_totp" DROP COLUMN "last_used_counter";
