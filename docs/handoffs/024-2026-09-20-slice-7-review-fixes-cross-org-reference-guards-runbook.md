# 2026-09-20 — Slice 7 review fixes: cross-org reference guards + runbook 0015/0016 (uncommitted)

Applied the two accepted slice-7 code-review findings on the committed slice-7
tree (HEAD `60f3ec5`; nothing applied to DigitalOcean). No migration or generated
file was touched.

- **Fix 1 (blocker) — cross-organization references were unguarded.**
  `calculateCostCard` and `calculatePriceScenario` org-checked only
  `productVariantId`; the single-column, org-agnostic FKs accepted a
  `location_id`/`channel_id`/`recipe_version_id` from another organization.
  Both commands now resolve every org-scoped reference **inside**
  `withTransaction` and throw `DomainError("<ref> not found")` /
  `DomainError("<ref> belongs to another organization")`, matching
  `registerOperatingCost`. Cost card guards `locationId` (required), `channelId`
  and `recipeVersionId`; price scenario guards `locationId` and `channelId`
  (both optional). `recipe_version` is org-scoped through its parent `recipe`.
  Ports gained `findLocation`/`findChannel` (both stores) and
  `findRecipeVersion` (cost-card store, returning `{ id, organizationId }`);
  implemented in the Postgres adapters (relational queries; a two-step
  `recipe_version` → `recipe` lookup) and in the fakes as seedable public maps.
  Tests: unit rejections (missing/foreign location, foreign channel, foreign
  recipe version; foreign/missing location+channel for the scenario) and one
  cross-org location rejection per Postgres integration test (raw inserts in the
  existing file style — the persistence `test-support` helpers are not exported
  across the package boundary).
- **Fix 2 — runbook.** `docs/runbooks/persistence-migrations.md` now documents
  `0015_calculation_snapshot_cost_card_index.sql`
  (`calculation_snapshot_cost_card_idx`, ledger `1789867750326`) and
  `0016_cost_card_approved_scope.sql` (`cost_card_approved_scope_key` partial
  unique `NULLS NOT DISTINCT WHERE state='approved'`, ledger `1789867797172`):
  migration-order rows, per-migration bullets, down companions, the ledger
  re-apply keys, the empty-database recovery range corrected to `0000–0016`, the
  `0016` index added to the raw-SQL inventory and the never-`push` warning, plus
  invariant-check entries.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **472 passed / 114 skipped
(586)**; with it **586 passed / 586 (60 files)**. `npx prettier --write` run on
every touched TypeScript file; `docs/` is prettier-ignored and matched by eye.
Rollback: revert/discard the working tree — the change is additive and touches
no migration or generated file. Next: commit (Rule 2), then the owner-gated
slice 8 (see "Resume here").
