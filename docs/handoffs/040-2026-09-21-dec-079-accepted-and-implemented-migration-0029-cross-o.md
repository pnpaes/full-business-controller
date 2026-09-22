# 2026-09-21 — DEC-079 accepted and implemented (migration 0029, cross-organization coherence guards); handoff updated

`main` HEAD `9d0e055`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **2 commits**
this slice: `8376209` docs(decisions) accept `DEC-079`; `9d0e055`
feat(persistence) cross-organization coherence guards (migration `0029`).

- **Delivered (`DEC-079`, closing `DEC-054`):** cross-organization coherence
  for `recipe_allergen.allergen_id`, `recipe_line.item_id`/`sub_recipe_id`
  and `goods_receipt_line.supplier_item_id` is enforced by
  `BEFORE INSERT OR UPDATE` guard triggers (the `stock_movement_source_guard`
  precedent), not denormalized composite FKs plus a backfill; the
  receipt-line guard also enforces the supplier and item match;
  `goods_receipt_line.supplier_item_id` got its deferred single-column FK
  (`NOT VALID` → `VALIDATE`). Migration `0029` is hand-written/journaled,
  forward-only, with a rehearsed unjournaled down path.
- **Review and reconciliation.** One structural pass (`reviewer-minimax`) —
  no blockers or majors. **Accepted and applied:** the five test-coverage
  gaps — UPDATE-repoint of `recipe_version_id`/`goods_receipt_id` on the
  three guarded tables, the `DEC-047` store-fallback accept path, and a
  unit-mismatch negative assertion. **Declined with reasons:** the cosmetic
  `FOUND` note, the no-op-UPDATE performance note, the `recipe_line` XOR
  invariant (a separate application-owned concern) and the `CREATE TRIGGER`
  non-idempotency note (covered by the down companion + ledger discipline).
- **Verification at `9d0e055` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1297/1297 tests with `DATABASE_URL`** (133 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0029` is a no-op on
  re-run; the `0029` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the `data_quality_exception` table (`DEC-066`'s interim
  replacement for `stock_transfer.discrepancy_note`; also the natural home
  for count-variance and yield-variance exceptions), then the import-profile
  table if time remains — see "Resume here". A dev server was running at
  http://localhost:3000 (owner/LocalDevPass123, demo-seeded); a fresh
  session must restart it (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0029` is
hand-written/journaled, forward-only, with a rehearsed **unjournaled** down
path (drop the guard triggers/functions and the FK, delete the ledger row,
re-migrate); no data migration; nothing pushed; nothing applied to
DigitalOcean.
