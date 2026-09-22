# 2026-09-22 — Row 13b delivered: close prerequisites + `adjustment_period` (`DEC-106`/`DEC-107`, migration `0059`); the row-13 close half is complete

`main`; HEAD before the slice was **`92b1682`** (the row-13a handoff). Row 13b
lands as: **`3ee7b25`** `fix(persistence)` (the missing `0058` snapshot),
**`2de4072`** `feat(persistence)` (`adjustment_period`), **`faeb049`**
`feat(application)`, **`6ac1158`** `feat(web)`, **`c903954`** `feat(close)`
(prerequisites + snapshot v2 + the row-13a race fix), **`956ceb6`**
`docs(decisions)` (`DEC-106`/`DEC-107`), plus this `docs(context)` handoff.
Nothing pushed; nothing applied to DigitalOcean. Verification at the committed
tree: `typecheck`, `lint`, `format:check`, `build` clean; **3112/3112 tests with
`DATABASE_URL` (208 files)**; `npm audit --omit=dev` = 0; `db:migrate` through
`0059` is a no-op on re-run; **89 tables**; the `0059` down path was rehearsed.

- **Delivered — close prerequisites (`REC-003`/`REC-005`, `DEC-107`).**
  `beginPeriodClose` evaluates the period and **blocks** (`DomainError`, nothing
  written, no audit fact) when an overlapping `reconciliation` is
  `pending`/`exception`, or an overlapping `import_run` is
  `uploaded`/`parsed`/`needs_review`/`validated`/`partially_posted` (the
  `DEC-035`/`DEC-082` intent extended). Open/acknowledged
  `data_quality_exception` counts and the effective-tolerance existence per kind
  are recorded **informationally only** (no period/location column). The frozen
  snapshot is now `schemaVersion: 2` with a `prerequisites` block;
  `schemaVersion: 1` stays readable. A `location` scope records
  `scopeLimited: true` (`reconciliation`/`import_run` have no location
  dimension — the systemic gap). `lockPeriodClose` does not re-evaluate.
- **Delivered — `adjustment_period` (`REC-006`, `DEC-106`).** Org-scoped
  `opened_from`/`opened_to` (`>=`), required `reason`, nullable all-or-nothing
  plain-uuid `approved_by`/`approved_at`, `status ∈ {open, closed}` default
  `open`, audit columns; a **partial unique** `adjustment_period_open_key` on
  `(organization_id) WHERE status = 'open'` (one open correction window per
  organization); `open → closed` with an idempotent close and **no reopen**;
  single-stage approval at open. API `/api/v1/adjustment-periods/**`
  (GET+POST, `[id]`, `[id]/close`).
- **Fixed — the row-13a create-race recovery (`c903954`).** The in-transaction
  catch-and-reread was broken on Postgres (a unique violation aborts the
  transaction, so the re-read failed with `25P02`). `beginPeriodClose` and
  `openAdjustmentPeriod` now recover on a **fresh transaction outside** the
  failed one; a locked winner surfaces as a `DomainError`. (The flaw had been
  accepted in the row-13a review and was copied into 13b-2; both are fixed.)
- **Fixed — metadata (`3ee7b25`).** `meta/0058_snapshot.json` was missing
  (trigger-only DDL, but every journalled migration carries a snapshot); added
  and the `0057 → 0058 → 0059` chain repaired, verified with an offline
  `db:generate` ("No schema changes").
- **Reviews:** three reviewers per workstream (qwen/minimax/glm), **no blocker
  after fixes** (the two blockers were the same aborted-transaction race, fixed
  in both). Accepted fixes: the race, the vocabulary dedupe, the `asOf`-correct
  fake tolerance, array-built blocker message, trimmed exports, dead-code/comment
  cleanups, SQLSTATE assertions, and the added edge tests (non-blocking statuses,
  inclusive period edge, spanning source, v1 read, lock-no-re-evaluation).
  Recorded, not fixed: no true two-connection race test (the fix is structural);
  the location scope cannot be enforced for reconciliation/import; the deferred
  correction-posting wiring and `daily_close`.
- **Schema:** migrations through **`0059`**; **89 tables**. Next free decision id
  **`DEC-108`**.
- **Reversibility:** each layer is an independently revertible commit
  (`git revert <sha>`). `0059` adds one table (down 89 → 88); the `0058` snapshot
  commit is metadata-only. On a DB rollback delete the ledger row
  (`when` `1790113826232`) and re-migrate.
- **Next:** the row-13 dashboards/menu-engineering half (`RPT-001`–`RPT-005`,
  `ADR-0007`; **data-gated on I11** — synthetic fixtures), the deferred
  correction-posting wiring/`daily_close`, or the receipt→ledger wiring if the
  OPS `storage_area_id` policy lands.
