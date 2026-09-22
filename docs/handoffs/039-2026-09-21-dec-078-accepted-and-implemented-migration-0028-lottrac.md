# 2026-09-21 — DEC-078 accepted and implemented (migration 0028, lotTracked, scope_type validation); handoff updated

`main` HEAD `a5c3db2`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **4 commits**
this slice: `3673633` docs(decisions) accept `DEC-078`; `ed93288`
feat(persistence) settlement/reconciliation vocabularies (migration `0028`);
`39d3364` feat(inventory) enforce `lotTracked` on stock movements; `a5c3db2`
feat(reconciliation) validate `scope_type` against the `DEC-078` vocabulary.

- **Delivered (`DEC-078`):** `settlement.status` constrained to `{received,
paid, void}` (default `received`); `reconciliation.scope_type` constrained
  to a new `reconciliation_scope_type` `{import_run, sales_source,
settlement, supplier_invoice}` (migration `0028`, check constraints
  `settlement_status_check`/`reconciliation_scope_type_check`) with
  `assertReconciliationScopeType` rejecting an unknown scope before any
  write; and a `lotTracked` item may no longer post a stock movement with a
  null `lotId` (one guard in `postStockMovementInternal`, covering all
  posting paths; the reversal stays exempt because it mirrors the original
  lot).
- **Review and reconciliation.** One cheap code-level pass (`reviewer-glm`)
  — no blockers or majors. **Accepted and applied:** one minor — the two
  unknown-scope rejection tests were strengthened with a message assertion.
  **Declined with reasons:** the runbook-rehearsal note (the `0028` down
  path was genuinely rehearsed by the implementing agent) and the
  vocabulary-alias note (the implementation matches the existing
  `imports/vocabularies.ts` alias convention).
- **Verification at `a5c3db2` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1279/1279 tests with `DATABASE_URL`** (132 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0028` is a no-op on
  re-run; the `0028` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the cross-organization referential-integrity /
  deferred-FK hardening (`DEC-054` recipe FKs + the `goods_receipt_line`
  composite FKs, `NOT VALID` → `VALIDATE`, migration `0029`+) — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0028` is
additive with a rehearsed unjournaled down path (drop the check constraints
and column default, delete the ledger row, re-migrate); no data migration;
nothing pushed; nothing applied to DigitalOcean.
