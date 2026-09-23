-- Down path for 0062_channel_fee_rule_lookup_index.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Drops the `DEC-112` `channel_fee_rule_lookup_idx` on
-- `(organization_id, channel_id, effective_from)` that covers the resolver and
-- `registerChannelFeeRule` lookups. It touches no table and no row, so it is safe
-- to run whenever the index must be removed (for example before a data repair);
-- while dropped, those lookups fall back to a sequential scan. Apply it manually
-- with
--   psql "$DATABASE_URL" -f packages/persistence/drizzle/0062_channel_fee_rule_lookup_index_down.sql
BEGIN;

DROP INDEX IF EXISTS "channel_fee_rule_lookup_idx";

COMMIT;
