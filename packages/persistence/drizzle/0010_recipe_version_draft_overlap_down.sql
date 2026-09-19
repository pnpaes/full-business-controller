-- Down path for 0010_recipe_version_draft_overlap.sql. Not listed in
-- meta/_journal.json on purpose: `drizzle-kit migrate` only applies journal
-- entries, so a rollback is an explicit operator action (see
-- docs/runbooks/persistence-migrations.md).
--
-- Restores the original ungated exclusion constraint from 0002_invariants.sql
-- (`recipe_version_no_overlap` over every state). Dropping and re-adding a
-- constraint removes no table and no row, but the re-add **VALIDATES every
-- existing row**: if overlapping draft versions were created while 0010 was
-- applied, this down fails and the transaction rolls back, leaving 0010 in
-- place. Resolve those overlaps (or delete the drafts) first, then re-run.
BEGIN;
ALTER TABLE "recipe_version" DROP CONSTRAINT IF EXISTS "recipe_version_no_overlap";
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_no_overlap"
  EXCLUDE USING gist (
    "recipe_id" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  );
COMMIT;
