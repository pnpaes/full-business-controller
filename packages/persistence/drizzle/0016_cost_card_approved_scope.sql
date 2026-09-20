-- Hand-written invariants (mirrors 0002_invariants.sql / 0005 / 0010 / 0012).
-- Slice-7 costing/DEC-060 review fix. `approveCostCard` supersedes the prior
-- approved card for a scope in the same transaction, but that application rule
-- has no database-level guarantee: two concurrent approvals could each see an
-- empty scope and both commit. This partial unique index enforces the DEC-060
-- invariant at the database, so exactly one `approved` card can exist per
-- `(organization_id, product_variant_id, location_id, channel_id)` scope.
--
-- `NULLS NOT DISTINCT` makes a null `channel_id` (a company-wide price) count as
-- a single scope rather than an unlimited one: PostgreSQL treats nulls as
-- distinct by default, which would let two company-wide approved cards coexist.
--
-- drizzle-kit has no representation for a partial unique index with
-- `NULLS NOT DISTINCT`, so the columns stay plain `uuid` in the TypeScript
-- schema and this is emitted here rather than in a generated migration
-- (hand-written invariants convention: see
-- docs/runbooks/persistence-migrations.md). The down companion
-- `0016_cost_card_approved_scope_down.sql` drops the index; like the other down
-- files it is not journaled.
CREATE UNIQUE INDEX "cost_card_approved_scope_key"
  ON "cost_card" ("organization_id", "product_variant_id", "location_id", "channel_id")
  NULLS NOT DISTINCT
  WHERE "state" = 'approved';
