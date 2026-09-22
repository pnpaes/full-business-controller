# 2026-09-22 — Row 13a period close/lock delivered (`REC-003`/`REC-006`, `DEC-027`, provisional `DEC-105`, migrations `0057`–`0058`); the `period_close` table + domain + application + web port

`main`; HEAD before the slice was **`bcec1b7`** (the handoff-folder refactor).
The slice lands as: **`415297b`** `feat(persistence)`, **`0daecac`**
`feat(domain)`, **`0139ac1`** `feat(application)`, **`c46e1a1`** `feat(web)`,
**`7694050`** `docs(decisions)` (`DEC-105`), plus this `docs(context)` handoff.
Nothing pushed; nothing applied to DigitalOcean. Verification at the committed
tree: `typecheck`, `lint`, `format:check`, `build` clean; **2994/2994 tests with
`DATABASE_URL` (203 files)**; `npm audit --omit=dev` = 0; `db:migrate` applied
`0057`/`0058` and is a no-op on re-run; the down path was rehearsed (88 → 88/0
triggers → 87 → delete 2 ledger rows → re-migrate → 88 tables, 3 triggers, 59
ledger rows). Three adversarial reviews (qwen/minimax/glm) found **no blocker**;
the accepted fixes are in the `feat(application)`/`feat(web)`/persistence
commits (lock/reopen `FOR UPDATE`, the begin race, the reopen route scope check,
the trigger immutability gaps, the company-scope `scopeId` check, parser/test
minors). After three adversarial reviews (qwen,
minimax, glm — no blockers) the accepted fixes were applied and everything was
re-verified: **2994/2994 tests (203 files)**; the `0058` guards were hardened
(the locked-row immutability also covers tenancy and the lock actor) and the
down/re-apply rehearsal re-run with the same counts; `0058`'s amended sha256 is
`63bcd67b11649d84e4c97342e6b859baec6b95e97d20719bdc967756267d10b3` (`0057` stays
`b2cbad1af69cbfca470cd31dd7d84e2ed9154cc4c170666fa2bb3d11e90f3e31`).

- **Delivered (`REC-003`, `REC-006`, `DEC-027`, provisional `DEC-105`):**
  `period_close` — `scope_type ∈ period_close_scope_type {location, company}`
  and NOT NULL plain-uuid `scope_id` (the `location.id` for a location scope,
  the `organization.id` for a company scope — no FK because the target varies),
  `period_start`/`period_end` (date), `status ∈ period_close_status {open,
  closing, locked, reopened}` default `open`, `checklist` jsonb default `'[]'`,
  nullable `snapshot` jsonb, nullable `correction_policy`, the nullable
  plain-uuid `locked_by`/`reopened_by` with their instants and `reopen_reason`,
  audit columns; the **granularity** check (location ⇒ a single day; company ⇒
  the UTC calendar month first→last day), the all-or-nothing lock/reopen checks,
  the `(organization_id, scope_type, scope_id, period_start)` unique and two
  org-first indexes. `0058` adds the scope-coherence guard (a location scope must
  name a location in the row's organization — existence **and** organization,
  because `scope_id` has no FK), the locked-snapshot immutability trigger
  (`locked` ⇒ `locked`/`reopened` only; snapshot/period/scope frozen) and the
  locked-delete block, all `23514`. Domain
  (`packages/domain/src/period-close.ts`): `resolveClosePeriod`,
  `assertCloseChecklist`, `buildCloseSnapshot` (`schemaVersion: 1`). Application
  (`packages/application/src/close/`): the `PeriodCloseStore` port +
  `createPostgresPeriodCloseStore` + `FakePeriodCloseStore`, the commands
  `beginPeriodClose` (idempotent while `closing`, re-begins a `reopened` row,
  refuses a `locked` one), `lockPeriodClose` (idempotent re-lock), the elevated
  `reopenPeriodClose` (reason required), plus `findPeriodClose`,
  `listPeriodCloses` and the `isPeriodLocked` read. Web
  (`/api/v1/period-closes/**`): `GET`+`POST`, `GET [id]`,
  `POST [id]/lock`, `POST [id]/reopen` with the `PERIOD_CLOSE_*` role sets.
- **Scope / deferrals (`DEC-105`, provisional):** `period_close` only;
  `adjustment_period` and `daily_close` deferred to 13b. The richer
  reconciliation/aggregate snapshot and the automatic prerequisite evaluation
  (open reconciliation, tolerances, exceptions) are **not** built. The
  `DEC-027` interaction with reversal/payroll regeneration stays open, as does
  I11. No `kitchen`/`purchasing` access; the close **list** route is not
  location-filtered (the recorded systemic location-scope gap) while `[id]`/
  begin/lock enforce the location scope.
- **Review fixes (accepted):** F1 `lockPeriodClose`/`reopenPeriodClose` load the
  row under a write lock (`lockPeriodCloseById`, `SELECT … FOR UPDATE`) so
  concurrent transitions serialise and only one audit fact is written; F2 the
  `beginPeriodClose` new-scope create race is caught and re-read as an idempotent
  no-op (the fake's `createPeriodClose` now rejects a duplicate, mirroring the
  unique); F3 the reopen route enforces the location scope for a location close;
  F4 the `0058` locked-row immutability also covers `organization_id` and
  `locked_by`/`locked_at` (declined: a `reopened` row stays editable); F5 a
  `company` scope's `scopeId` must equal the organization id; F6 an explicit
  `checklist: null` is a 400 (only a missing value defaults to `[]`); F7 the fake
  list tie-breaks by insertion order; F8 added the idempotent re-lock route test
  and the `front_of_house` company-close 403 test; F9 the scope-guard message
  interpolates the actual found org and the `0057` down header notes that `0058`'s
  down must run first (trigger functions survive `DROP TABLE`). Declined as
  recorded: the `reopened` immutability guard, DB-level transition gating, list
  location filtering, snapshot read validation and a status-tied NOT NULL lock
  pair.
- **Reversibility:** each layer is an independently revertible commit (`git revert <sha>`). Migration `0057_period_close` adds one
  table (additive; down 88 → 87); `0058_period_close_org_guard` is trigger-only
  (down 88 → 88); the rehearsed down order is **`0058` → `0057`**; on a DB
  rollback delete the two ledger rows (`created_at` `1790110579392` /
  `1790110580000`) and re-migrate — 88 tables after re-apply.
- **Next:** the receipt→ledger wiring (gated on the OPS `storage_area_id`
  policy) or row-13b (adjustment/daily close + the reconciliation snapshot) once
  the row-13 data gate (I11) and `DEC-105` are confirmed.
