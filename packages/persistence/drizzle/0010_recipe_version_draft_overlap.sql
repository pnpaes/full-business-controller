-- Hand-written invariant (mirrors 0002_invariants.sql / 0005 / 0007). Slice-5
-- review fix, recorded as DEC-053: `recipe_version_no_overlap` was ungated, so
-- two *draft* versions of one recipe could not overlap in time — an operational
-- blocker for parallel drafting, and stricter than the effective-dated-window
-- rule requires. The exclusion now applies only to versions that can be
-- effective for costing and selling: `approved` and `submitted`. Drafts (and
-- rejected/retired rows) may overlap freely.
--
-- The domain resolver still rejects an ambiguous effective set when it selects
-- one, so an overlap among approved/submitted rows remains a data-integrity
-- failure; this constraint enforces it at the database for exactly those states.
-- The columns are plain `text`/`tstz` in the TypeScript schema, so
-- `drizzle-kit generate` never sees or fights this (hand-written invariants
-- convention: see docs/runbooks/persistence-migrations.md).
--
-- Drop and recreate under the same name so the 0002 definition is superseded
-- rather than duplicated. Never edit 0002 itself.
ALTER TABLE "recipe_version" DROP CONSTRAINT "recipe_version_no_overlap";
--> statement-breakpoint
ALTER TABLE "recipe_version" ADD CONSTRAINT "recipe_version_no_overlap"
  EXCLUDE USING gist (
    "recipe_id" WITH =,
    tstzrange("effective_from", "effective_to") WITH &&
  ) WHERE ("state" IN ('approved', 'submitted'));
