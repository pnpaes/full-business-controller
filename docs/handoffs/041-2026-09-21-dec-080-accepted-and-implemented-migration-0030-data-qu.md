# 2026-09-21 — DEC-080 accepted and implemented (migration 0030, `data_quality_exception` + transfer-discrepancy producer); handoff updated

`main` HEAD `ddc9e06`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **3 commits**
this slice: `40b5d7e` docs(decisions) accept `DEC-080`; `d1d0fad`
feat(persistence) `data_quality_exception` table (migration `0030`); `ddc9e06`
feat(transfers) record a data-quality exception on receive discrepancy.

- **Delivered (`DEC-080`, DQ-001):** the `data_quality_exception` table
  (`rule_code`, `severity ∈ {low, medium, high, critical}` default
  `medium`, `entity_type`/`entity_id` polymorphic, `detected_at`,
  `owner_id`, `due_date`, `status ∈ {open, acknowledged, resolved,
dismissed}` default `open`, `resolution`); repository
  create/find/list/update; and the first producer —
  `receiveStockTransfer` creates a `transfer_discrepancy` exception
  (severity `high`, entity `stock_transfer`, status `open`) in the same
  transaction as the receive, alongside the human `discrepancy_note`.
  Migration `0030` is additive with a rehearsed down path.
- **Review and reconciliation.** One cheap code-level pass (`reviewer-glm`)
  — no blockers or majors. **Declined with reasons (all four minors):** the
  id-only `updateDataQualityException` (matches the `updateStockCount`
  convention); the application mapping dropping audit columns (no consumer
  needs them); the record fields typed `string` (like the other tables); a
  dead savepoint in one rollback test (harmless).
- **Verification at `ddc9e06` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1305/1305 tests with `DATABASE_URL`** (134 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0030` is a no-op on
  re-run; the `0030` down path rehearsed; **65 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** the **import-profile table** — the row-11 open point
  (`import_run.source`/`profile_version` are opaque labels), keyed by
  `(organization_id, source)`, recorded from `DEC-081` if needed — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0030`
is additive (a new table; no data migration) with a rehearsed **unjournaled**
down path (drop the table, delete the ledger row, re-migrate); nothing
pushed; nothing applied to DigitalOcean.
