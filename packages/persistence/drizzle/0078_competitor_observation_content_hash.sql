-- `ADR-0010` / `DEC-149` follow-up: idempotent automated capture. The collector
-- re-recorded the same facts as new `pending` observations every run; this adds a
-- nullable `content_hash` and a **partial** unique index keyed on
-- `(organization_id, competitor_source_id, content_hash)` `WHERE content_hash IS
-- NOT NULL`.
--
-- Expand-only and safe on a live table: adding a nullable column is a metadata
-- change, and the partial index only constrains rows that carry a hash. A
-- manual/pre-existing row (no hash) is unaffected and may repeat; the shape is a
-- partial **index** rather than a table UNIQUE constraint because a constraint
-- cannot express the `WHERE` predicate (and would allow only one NULL per source).
-- Pre-existing rows with a hash: none today (every row's `content_hash` is NULL
-- after the expand), so the index builds without a duplicate scan failure.
--
-- The up companion is journaled (drizzle-kit generates it); the down companion
-- `0078_competitor_observation_content_hash_down.sql` is hand-written and NOT
-- journaled (`drizzle-kit migrate` applies journal entries only), so a rollback
-- is an explicit operator action (docs/runbooks/persistence-migrations.md).
ALTER TABLE "competitor_observation" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_observation_org_source_content_hash_key" ON "competitor_observation" USING btree ("organization_id","competitor_source_id","content_hash") WHERE "competitor_observation"."content_hash" is not null;
