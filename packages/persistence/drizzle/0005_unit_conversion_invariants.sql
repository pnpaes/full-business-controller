-- Invariants the generated DDL cannot express (mirrors 0002_invariants.sql).
-- `unit_conversion` is an effective-dated financial input, so DATA_DICTIONARY §0
-- requires an EXCLUDE constraint on every such table. `item_id` is nullable, so
-- two exclusion constraints are used: one for the global scope (`item_id IS
-- NULL`) and one for the item scope (`item_id IS NOT NULL`). An item-scoped row
-- and a global row may both be effective — that cross-scope conflict is *not* an
-- overlap; the domain resolver rejects it as ambiguous instead (DEC-050).
-- Hand-written, deliberately outside drizzle-kit: the columns are plain `uuid`
-- in the TypeScript schema, so `drizzle-kit generate` never fights these.

-- 1. No two effective rows may cover the same global (organization, from, to).
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_global_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "from_unit_id" WITH =,
    "to_unit_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  ) WHERE ("item_id" IS NULL);

-- 2. No two effective rows may cover the same item-scoped (organization, from,
--    to, item).
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_item_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "from_unit_id" WITH =,
    "to_unit_id" WITH =,
    "item_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  ) WHERE ("item_id" IS NOT NULL);

-- 3. At most one row per version tuple. `NULLS NOT DISTINCT` so a global row
--    (null `item_id`) collides with another global row at the same
--    `effective_from`, matching the exclusion semantics above.
ALTER TABLE "unit_conversion" ADD CONSTRAINT "unit_conversion_version_key"
  UNIQUE NULLS NOT DISTINCT (
    "organization_id", "from_unit_id", "to_unit_id", "item_id", "effective_from"
  );
