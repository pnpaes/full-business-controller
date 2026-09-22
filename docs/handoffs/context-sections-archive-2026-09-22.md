# Context sections archive — 2026-09-22

Verbatim archive of the `Resume here`, `Current status`, `Next up` and
`Open decisions / inputs` sections from `CONTEXT.md` immediately before the
handoff-folder refactor (commit history: `0fa8224` and earlier). Kept for
reference only; the live orientation is the lean `CONTEXT.md` and the
per-slice files in this folder.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to
continue from this section alone. (This section was rewritten by the
2026-09-22 row-14b-2 payroll-input-report handoff session.)

**State:** `main`; HEAD before the row-14b-2 slice was **`32231d6`** (the
row-14b-1 handoff). Row 14b-2 lands as: **`f17fb29`** `feat(persistence)`,
**`87e92f5`** `feat(domain)`, **`321d6e5`** `feat(application)`,
**`2285e2e`** `feat(web)`, **`40595a9`** `fix(scheduling)` (the review
fixes), **`2690959`** `docs(decisions)` (`DEC-104`), the roadmap update,
plus this `docs(context)` handoff. Nothing pushed; nothing applied to
DigitalOcean.

**Delivered (row 14b-2 — `WF-005`, `DEC-037`, provisional `DEC-104`;**
**row 14 is now complete: 14a + 14b-1 + 14b-2):** the **`payroll_report`**
monthly payroll-input report — schema + snapshot + application + web port.

- **`payroll_report`** — `period_start`/`period_end` (date,
  `period_end > period_start`), `generated_at`, nullable plain-uuid
  `generated_by`, `status ∈ payroll_report_status {draft, generated,
exported, superseded}` default `draft` (every producer writes
  `generated`), a `snapshot` jsonb, a nullable **real** `file_object`
  `export_file_id` FK, audit columns; the **partial unique**
  `payroll_report_org_period_key` on `(organization_id, period_start)`
  `WHERE status <> 'superseded'` (one _live_ report per period; superseded
  history retained). The `0056` guard covers the nullable `export_file_id`.
- **Snapshot** (`packages/domain/src/payroll.ts`): `{ schemaVersion: 1,
currency: "NOK", periodStart, periodEnd, lines: [{ employeeId,
employeeName, roleCode, hours, hourlyRate, expectedPay }],
totalHours, totalExpectedPay }`, decimal strings only;
  `expectedPay = hours × hourlyRate` at money scale 4 HALF_UP; lines
  ordered by name then id; totals at their scales.
- **Application:** `generatePayrollReport` (validated period, the
  worked-hours derivation reused with the employee's `base_hourly_rate`,
  snapshot built, the prior **live** same-period report superseded under a
  `SELECT … FOR UPDATE` lock before insert), `findPayrollReport`,
  `listPayrollReports`, `markPayrollReportExported` (only from
  `generated`).
- **Access:** `PAYROLL_REPORT_READ/WRITE_ROLES` = owner, general_manager,
  finance, admin — the `Payroll-input reports` matrix row;
  **`location_manager` deliberately excluded here** (the matrix says None)
  even though the worked-hours report grants it (a recorded `DEC-104`
  asymmetry); `analyst` "Aggregate" unimplemented (fail-closed); the
  accountant is not a modelled role.
- **Period:** `[periodStart T00:00:00Z, dayAfter(periodEnd) T00:00:00Z)`
  (the whole `period_end` day included), UTC calendar arithmetic.
- **Generation is on demand** — the "~3 days before month-end" trigger is
  `ADR-0004`-gated (still `Proposed`), not built.
- **API:** `GET/POST /api/v1/workforce/payroll-reports`,
  `GET /payroll-reports/[id]`, `POST /payroll-reports/[id]/export`.
- Migrations `0055`/`0056`; `EXPECTED_TABLES` 86 → 87; `payroll_report`
  removed from `NOT_EXPECTED_TABLES`.

**Prior slice (condensed):** the **row-14b-1 worked-hours** slice
(`WF-004`, `DEC-037`/`DEC-038`, provisional `DEC-103`, migrations
`0053`/`0054`) — `shift_adjustment` (`shift_assignment_id` FK,
`adjusted_hours numeric(9,2)` >= 0, required `reason`, nullable
`approved_by`/`approved_at`, audit columns, the `0054` cross-org guard) +
the worked-hours derivation (domain, decimal-only: an assignment
contributes when `shift_assignment.state = 'approved'`, shift state ∈
{assigned, completed}, `starts_at` in `[from, to)`; latest
`shift_adjustment.adjusted_hours` else `(ends_at − starts_at) −
break_minutes`, floored at zero, scale 2 HALF_UP) with
`computeWorkedHours`, `createShiftAdjustment` and the list/find queries;
access `WORKED_HOURS_READ/WRITE_ROLES` = owner, general_manager,
location_manager, finance, admin (`analyst` excluded, fail-closed);
API `GET/POST
/api/v1/workforce/shift-assignments/[id]/adjustments` and
`GET /api/v1/workforce/worked-hours`; the report is persisted. Prior to
that, the **row-14a shift scheduling** slice (`WF-002`/`WF-003`,
provisional `DEC-102`, migrations `0051`/`0052`) — `shift` +
`shift_assignment` with the provisional state machine
(`open → published → assigned → completed`, `open|published → cancelled`,
terminal `completed`/`cancelled`), manager-assignment only (self-assignment
deferred pending the **WF-003 self-assignment login model**), three
cross-org coherence guards, and the shifts/assignments application + web
port. Full detail in "Current status", the work log and the "Open
decisions / inputs" bullets.

**Schema:** migrations through **`0056`**; **87 tables** (was 86). Next
free decision id **`DEC-105`**.

**Verification (exact, at the committed tree):** `typecheck`, `lint`,
`format:check`, `build` clean; **2830/2830 tests with `DATABASE_URL`** (196
files); `npm audit --omit=dev` = 0; `db:migrate` through `0056` a no-op on
re-run; **87** public base tables.

**Migrations:** `0055_payroll_report` (journal `idx` 55, `when`
`1790069367957`, sha256
`18b9789e64c5fb462828402036ec0a9d87c9090d43034a71fd1de9932c7ae87d`);
`0056_payroll_report_org_guard` (journal `idx` 56, `when`
`1790069368959`, sha256
`4aa9675bcd8156f4882aade667c9dc3ecab3e4f69e5ac2ded508c0dccff63631`). Down
companions (unjournalled): `0055_payroll_report_down.sql` (drops
`payroll_report`; 87 → 86), `0056_payroll_report_org_guard_down.sql`
(trigger-only). **Rehearsed 2026-09-22:** 87 tables / 1 payroll guard /
57 ledger rows → `0056` down (87, 0 guards) → `0055` down (86) → delete
the two ledger rows (`created_at IN (1790069367957, 1790069368959)`) →
`npm run db:migrate` → 87 tables / 1 guard / 57 ledger rows; a further
`db:migrate` a no-op.

**Reviews and reconciliation (recorded honestly):** both reviewers found
**no blocker**. Two majors, **accepted + fixed** (both reviewers
independently): `findPayrollReportForPeriod` could return a **superseded**
row (no status predicate, no order), breaking the third regeneration of a
period with a raw 23505 → 500 — now filters `status <> 'superseded'` (and
the fake mirrors it); the **supersede-then-insert was not serialised**, so
concurrent generations could collide — now `lockPayrollReportForPeriod`
(`SELECT … FOR UPDATE`). Minors, **accepted + fixed**: the web parser's
duplicate status list now imports the exported `PAYROLL_REPORT_STATUSES`;
a `ponytail:` note records the current-rate-for-the-whole-period
simplification; added tests for the triple regeneration, the live-row
lookup, and a `draft` export refusal. Recorded in `DEC-104`, not fixed:
the **"remaining planned shifts run as scheduled"** assumption is **not**
implemented (only `{assigned, completed}` shifts count, so a
pre-month-end report under-counts — the biggest open item); whether the
**base or loaded** rate is intended; `currency` hard-coded `NOK`; the
`draft` status is unreachable through the API; the `DEC-027` period-lock
interaction; retention; the application-layer-only audit. Both reviewers
verified the `0055` SQL matches the schema, the partial unique is the
right model, the decimal snapshot math is float-free with HALF_UP, and
the down path is FK-safe.

**Next task:** two buildable candidates, in this order:

1. **Receipt→ledger wiring** — gated on the **OPS receipt destination
   `storage_area_id` policy**, a recorded owner input. If it has not
   landed, it stays blocked; do not resolve the policy silently.
2. **Row 13 — close + dashboards + menu engineering** (`ADR-0007` accepted
   2026-09-20; **data-gated on history/grain quality I11** — synthetic
   fixtures until real data; `DEC-027` monthly period lock/close is the
   close half).

Then the test-deployment rehearsal (parked on owner inputs: a scoped
`DIGITALOCEAN_TOKEN`, a private Spaces state bucket, the sanitized-data/
clone decision, `ADR-0004` acceptance, the legacy slug check) and the
golden-fixture sign-off.

**Step after:** the golden-fixture sign-off and the remaining parked owner
inputs; the roadmap row-14 cell is complete — the **programme (Phase 6 +
Epics 20/21, `DEC-086`…`DEC-094`) is fully delivered** (19a–19e, 20a–20c,
14a/14b-1/14b-2).

**Scope (do):** implement the next candidate per the existing package
boundaries: the receipt→ledger wiring only if the OPS
destination-`storage_area_id` policy has landed (else row 13), with
synthetic fixtures for row 13
until real data (I11), organization-scoped, additive, with a rehearsed
down path, `EXPECTED_TABLES` updated, a `.test.ts` for new non-trivial
logic, small atomic commits with the rollback approach in the body (per
`AGENTS.md` Rule 2), and `CONTEXT.md` updated at the end.

**Scope (do not):** do not resolve the OPS receipt
destination-`storage_area_id` policy silently — if it has not landed, do
not invent or apply it. Do not resolve row-13 history/grain quality (I11)
or the `DEC-027` period-lock interaction silently. Do not resolve the
recorded open inputs silently — in particular the **`DEC-104`
provisional items** (the "remaining planned shifts run as scheduled"
assumption, base vs loaded rate, `NOK`, `draft` unreachable, retention),
the **`DEC-102`/`DEC-103` provisional items**, the **WF-003
self-assignment login model** and the **privacy-review retention periods
per file class** (record them, decide nothing), plus the standing systemic
`writeAudit` transaction binding, the driver-error→500 mapping and the
systemic location-scope gap. Do not build the `job` table, the
worker/scheduler or the outbox async layer (gated on `ADR-0004`, still
`Proposed`). Do not add a self-assignment endpoint (fail-closed). Do not
deploy, `terraform apply`, or write externally (`DEC-015`). Do not rewrite
the specification inputs.

**Files/paths:** for the receipt→ledger wiring —
`packages/persistence/` + `packages/application/src/inventory/`
(+ `docs/runbooks/persistence-migrations.md` only if a migration is
needed); for row 13 — new priced-report/dashboards domain/application
modules per the existing package boundaries, the web reporting screens,
migration docs in `docs/runbooks/persistence-migrations.md`;
`12_OPEN_DECISIONS.md` for any `DEC-105` provisional clarification; update
`CONTEXT.md` at the end.

**Authoritative docs to read first:** for the receipt→ledger wiring —
`DATA_DICTIONARY.md` §6 (`goods_receipt` destination storage area), the
slice-8 roadmap entry "goods-receipt acceptance is not yet wired to the
ledger" (`docs/BUILD_ROADMAP.md` §5), `docs/runbooks/persistence-migrations.md`,
the access-matrix `Payroll-input reports`; for row 13 — `11_REQUIREMENTS_CATALOG.md` (row 13, close/dashboards), `docs/adr/0007-reporting-aggregates.md`
(accepted), `DEC-027` in `12_OPEN_DECISIONS.md`, `08_UI_UX.md` dashboards,
`CALCULATION_CONTRACT.md`, `docs/BUILD_ROADMAP.md` §1 and §4; this file's
"Open decisions / inputs"; `AGENTS.md` Rules 1–3.

**Acceptance / verification:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh";
nvm use 22`, then `npm run typecheck` before the change, `npm run lint`,
`npm run test` (with `DATABASE_URL` — current baseline: **2830/2830**, 196
files), `npm run build`, `npm run format:check`, `npm audit --omit=dev` = 0;
`db:migrate` applies any new migration, is a no-op on re-run, and its down
path is rehearsed; after each commit re-run the suite at the clean tree and
confirm HEAD advanced.

**Programme direction (standing user instruction):** proceed autonomously — per
task: parallel background agents → adversarial review + fixes → document status
and next steps → commit → next task. Global ruleset
(`~/.config/kilo/AGENTS.md`): compact context at 25 %; pausing is permitted
above USD 20 at a clean point (committed, verified, documented).

**Open inputs (recorded, do not decide):** from this slice — the **`DEC-104`
provisional items** awaiting owner/OPS confirmation (the **"remaining
planned shifts run as scheduled"** assumption is **not** implemented — only
`{assigned, completed}` shifts count, so a pre-month-end report
under-counts, the biggest open item; whether the **base or loaded** rate is
intended; `currency` hard-coded `NOK`; the `draft` status is unreachable
through the API; the `DEC-027` monthly period-lock interaction; the
working-time retention period; the application-layer-only audit); plus the
carried-over **`DEC-103` provisional items** (the single-stage
adjustment-approval model — the actor is the approver, the nullable
`approved_by`/`approved_at` pair supports a future two-stage flow; the
**`analyst` exclusion** from the worked-hours report — the matrix's
"Aggregate" is unimplemented; the worked-hours report is not persisted; the
working-time retention period); plus the carried-over **`DEC-102`
provisional items** (the provisional shift state machine;
manager-assignment-only with self-assignment deferred pending the **WF-003
self-assignment login model**; the dictionary's `shift.created_by` NOT NULL
FK `app_user` satisfied by the nullable plain-uuid audit `created_by`;
`shift_assignment`'s audit columns a convention; multi-assignment per shift
with no headcount invariant; the `listShifts`/`listShiftAssignments` ordering
not fully index-covered; `role_code` free text), the **`DEC-101` provisional
items** (the 12 workflow-platform clarifications) and the staff-document open
points (the unenforceable per-document location scope, the acknowledgement
retention period, no un-archive, the `DEC-100` provisional items, the storage
path deferred with `file_object` having **no application port**). Plus the
next-slice inputs: the **OPS receipt destination `storage_area_id` policy**
(gates the receipt→ledger wiring) and the **row-13 data gate —
history/grain quality (I11)** (synthetic fixtures until real data) — plus the standing systemic ones already in
the file (the `writeAudit` transaction binding, the driver-error→500
mapping, the systemic location-scope gap, the `ADR-0004` gate, the
golden-fixture sign-off). Full list under "Open decisions / inputs"; next
free decision id **`DEC-105`**.

**Parallel owner action — golden-fixture sign-off:** the six golden fixtures are
prepared as machine-readable JSON under `tests/fixtures/` (`DEC-065`) with the
sign-off trail ready; finance + product owner sign. Until signed, no cost is
"verified"; `I8`/`I9` still gate the real rates behind the fixtures.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs); the
foundation scaffold, the Phase 1–2 persistence core, the auth slices (1a–1e), the
UI token foundation, master-data slices 2–3, slice 4 (receipt + price history +
landed cost), slice 5 (recipes), slice 6 (operating costs + labour + allocation),
slice 7 (cost card + snapshots + price scenario + approval), slice 8 (stock
ledger + balances + lots/storage), slices 9 (counts + transfers + waste), slice
10 (production planning + batches, including the web layer), row 11 (import
framework + external mappings) and row 12 (sales + settlements + reconciliation)
— **all committed** (rows 11 and 12 complete; the
price-version slice — `price_version` with approval-driven effective versions
— complete, the `DEC-078` vocabulary/`lotTracked`, `DEC-079`
cross-organization coherence, `DEC-080` `data_quality_exception` and `DEC-081`
import-profile integrity points, the `DEC-082` `postImportRun`
posting-policy enforcement — the run's recorded `diagnostics.posting_policy`
snapshot governs, `all_or_nothing` refuses pre-write with a `DomainError` naming
the blocking rows — the `DEC-083` `import_disposition` table, which moved
the dispositions out of the `diagnostics.dispositions` jsonb (its frozen-key
contract step delivered as migration `0034`), the provisional `DEC-084`
`PROD-003` count-variance/yield-variance exception
producers, and the `DEC-085` `file_object` platform table (migration `0035`,
with the `import_run.file_object_id` FK and the `file_object_org_guard`
trigger `0036` — row 11 complete), with the design
system/app shell/screens and migrations `0017`–`0045`; the
`DEC-089` HMS monitoring-points + readings slice, the `DEC-090`
incidents + corrective-actions slice, the `DEC-091` checklists slice, the
`DEC-092` equipment/maintenance slice and the `DEC-093` compliance /
evidence export slice —
the first five build slices of the `DEC-086`–`DEC-094` programme
(migrations `0037`–`0045`; the HMS half of the programme is now complete) —
are committed; the `DEC-087` `employee` + personnel-documents slice (the
`DEC-099` provisional clarifications; migrations `0046`/`0047`; the first slice
of the workforce-documents half) is **committed** (`246c735`…`5b932a8`); the
`DEC-088` **staff document library** slice (the `DEC-100` provisional
clarifications; migrations `0048`/`0049`; the programme's **first versioned
entity** — `document`, `document_version`, `document_acknowledgement`) is
**committed** (`2784f18`…`838d11a`); the `DEC-094` **workflow platform**
slice (the `DEC-101` provisional clarifications; migration `0050`;
schema-only — the `task`/`approval` tables, no application/web port; the
`job`/worker/outbox layer gated on `ADR-0004`) is **committed** (`c90a45a`);
the
`DEC-072`–`DEC-085` low-risk implementations (effective-dated reconciliation
tolerance, sales-line reversal, `MAPPING_STATE` `conflict`, typed recipe 404s,
the `price_version` slice, the `settlement.status`/`reconciliation.scope_type`
vocabularies, `lotTracked` enforcement, the cross-organization coherence
guards, the `data_quality_exception` table, the `import_profile` table and the
import posting-policy enforcement).

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-104); the
  authority. New decisions are appended here (next free id `DEC-105`).
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`
  and `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012` (`ADR-0005`,
  `ADR-0007` and `ADR-0008` accepted 2026-09-20).
- `docs/runbooks/` — operator runbooks (`persistence-migrations.md`, `deployment.md`).
- `docs/BUILD_ROADMAP.md` — the ordered slice backlog and per-slice execution loop (a
  derived execution tracker; decisions and accepted ADRs stay the authority).
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/*` — code (config, logger, domain, application,
  persistence; `web`, `worker` and `scheduler` runtimes).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **As of:** 2026-09-22 — branch `main`; HEAD before the row-14b-2 slice was
  `32231d6` (the row-14b-1 handoff); the row-14b-2 slice lands as commits —
  **`f17fb29`** `feat(persistence)`, **`87e92f5`** `feat(domain)`,
  **`321d6e5`** `feat(application)`, **`2285e2e`** `feat(web)`,
  **`40595a9`** `fix(scheduling)` (the review fixes), **`2690959`**
  `docs(decisions)` `DEC-104`, the roadmap update, plus this
  `docs(context)` update; the branch was clean before these handoff edits.
  Lineage:
  `02f7c33` (the Phase A / small-TECH handoff) → the HMS monitoring slice,
  5 commits → the HMS incidents + corrective-actions slice, 6 commits → the
  HMS checklists slice, 6 commits → the HMS equipment / maintenance slice,
  6 commits → the HMS compliance / evidence export slice, 5 commits →
  the `employee` + personnel-documents slice (programme step 20a), 5 commits →
  the staff document library slice (programme step 20b), 6 commits →
  the workflow-platform slice (`DEC-094`, schema-only) →
  the row-14a shift-scheduling slice (`WF-002`/`WF-003`, `DEC-102`) →
  the row-14b-1 worked-hours slice (`WF-004`, `DEC-103`) →
  **the row-14b-2 payroll-input-report slice (`WF-005`, `DEC-104`)** —
  **all committed** (see "Work log" and "Reversibility").
  **Delivered (row 14b-2 — `WF-005`, `DEC-037`, provisional `DEC-104`;
  row 14 complete: 14a + 14b-1 + 14b-2):** the `payroll_report` table
  (`period_start`/`period_end` date with `period_end > period_start`,
  `generated_at`, nullable plain-uuid `generated_by`, `status ∈
payroll_report_status {draft, generated, exported, superseded}` default
  `draft` — every producer writes `generated` — a `snapshot` jsonb, a
  nullable **real** `file_object` `export_file_id` FK, audit columns; the
  **partial unique** `payroll_report_org_period_key` on
  `(organization_id, period_start) WHERE status <> 'superseded'` — one
  _live_ report per period, superseded history retained; the `0056` guard
  covers the nullable `export_file_id`). Snapshot
  (`packages/domain/src/payroll.ts`): `{ schemaVersion: 1, currency:
"NOK", periodStart, periodEnd, lines: [{ employeeId, employeeName,
roleCode, hours, hourlyRate, expectedPay }], totalHours,
totalExpectedPay }`, decimal strings only, `expectedPay = hours ×
hourlyRate` at money scale 4 HALF_UP, lines ordered by name then id.
  Application: `generatePayrollReport` (validated period, the
  worked-hours derivation reused with the employee's `base_hourly_rate`,
  the prior **live** same-period report superseded under a `SELECT … FOR
UPDATE` lock before insert), `findPayrollReport`, `listPayrollReports`,
  `markPayrollReportExported` (only from `generated`). Access:
  `PAYROLL_REPORT_READ/WRITE_ROLES` = owner, general_manager, finance,
  admin (the `Payroll-input reports` matrix row); **`location_manager`
  deliberately excluded** (matrix None — a recorded `DEC-104` asymmetry
  vs the worked-hours report); `analyst` "Aggregate" unimplemented
  (fail-closed). Period `[periodStart T00:00:00Z,
dayAfter(periodEnd) T00:00:00Z)` — the whole `period_end` day, UTC
  calendar arithmetic. Generation is **on demand** (the "~3 days before
  month-end" trigger is `ADR-0004`-gated, not built). API:
  `GET/POST /api/v1/workforce/payroll-reports`,
  `GET /payroll-reports/[id]`, `POST /payroll-reports/[id]/export`.
  **Nothing applied to DigitalOcean.**
  **Prior slice (row 14b-1 — worked hours, `WF-004`, `DEC-037`/`DEC-038`,
  provisional `DEC-103`, migrations `0053`/`0054`, committed
  `a67fe49`…`f49490a`):** the `shift_adjustment` table
  (`shift_assignment_id` FK, `adjusted_hours numeric(9,2)` >= 0 capped at
  9999999.99, required `reason`, nullable `approved_by`/`approved_at` with
  the all-or-nothing `shift_adjustment_approved_check`, audit columns; the
  `0054` cross-org guard on `shift_assignment_id`, `23514`) and the
  worked-hours derivation (domain, decimal-only never floats): an
  assignment contributes hours when `shift_assignment.state = 'approved'`
  and `shift.state ∈ {assigned, completed}` and the shift `starts_at` is
  in the report's half-open period `[from, to)`; per assignment the hours
  are the **latest `shift_adjustment.adjusted_hours`** when one exists,
  else `(ends_at − starts_at) − break_minutes`, floored at zero, at scale
  2 HALF_UP; `sumWorkedHoursByEmployee` sums per employee ordered by name
  then id. Application: `createShiftAdjustment` (validated decimal string,
  approved by the acting manager at write time — single-stage, rejected on
  a withdrawn assignment), `find`/`listShiftAdjustment(s)`, and
  `computeWorkedHours` (the derived per-employee report for a period,
  `{ from, to, rows, totalHours }`). Access: `WORKED_HOURS_READ_ROLES`/
  `WRITE_ROLES` = owner, general_manager, location_manager, finance, admin
  (`analyst` excluded — the matrix's "Aggregate" is unimplemented; the
  adjustment register follows the worked-hours roles, **not** the rota
  read roles, a review fix so the payroll hours do not leak to
  kitchen/FOH). API: `GET/POST
/api/v1/workforce/shift-assignments/[id]/adjustments` and
  `GET /api/v1/workforce/worked-hours`. The report is **not persisted**
  (computed on demand).
  **Prior slice (row 14a — shift scheduling, `WF-002`/`WF-003`,
  `DEC-037`/`DEC-038`, provisional `DEC-102`, migrations `0051`/`0052`,
  committed `f3a990b`…`da745f0`):** the `shift` +
  `shift_assignment` tables with the full application + web port —
  `shift` (location-scoped, nullable `role_code`, `starts_at`/`ends_at` with
  `ends_at > starts_at`, `break_minutes >= 0` default 0,
  `state ∈ shift_state {open, published, assigned, cancelled, completed}`
  default `open`, nullable `published_at`/`actual_start`/`actual_end` — the
  actual_* columns reserved for later time tracking, unused in the MVP —
  audit columns) and `shift_assignment` (`shift_id`/`employee_id` FKs,
  `state ∈ shift_assignment_state` with only `approved`/`withdrawn`
  reachable, nullable `assigned_by` (null = self-assigned), `assigned_at`,
  unique `(shift_id, employee_id)`, audit columns); three cross-org
  coherence guards (`0052` — `shift.location_id`,
  `shift_assignment.shift_id`, `shift_assignment.employee_id`, all NOT NULL
  → unconditional, `23514`). Provisional state machine (`DEC-102`): `open →
published` (stamping `published_at`) → `assigned` (on an approved manager
  assignment) → `completed`; `open|published → cancelled`;
  `completed`/`cancelled` terminal — a shift in `assigned` must be withdrawn
  before cancelling, and a terminal shift cannot be
  amended/published/completed/withdrawn (each a `DomainError`).
  **Manager assignment only:** `assignShift` creates an `approved` assignment
  and sets the shift `assigned` (enforcing the employee's `role_code`
  against a non-null shift `role_code` per WF-003 "within their role", and
  the `primary_location_id` against the shift location, fail-closed on null
  per the `DEC-099` precedent); `withdrawShiftAssignment` reverts the shift
  to `published`/`open`. **Self-assignment
  (`self_assigned`/`pending_approval`/`rejected`) is deferred** pending the
  **WF-003 self-assignment login model** (still an open owner input) — no
  self-assign endpoint (fail-closed). Access (the `Shift planning and rota`
  matrix row; `analyst`/`purchasing` excluded): read = owner,
  general_manager, location_manager, kitchen, front_of_house, finance,
  admin; write = owner, general_manager, location_manager (location-scoped),
  admin; kitchen/FOH "View own" **not** yet narrowed to own shifts (deferred
  with self-assignment). API: `/api/v1/workforce/shifts/**` (GET/POST,
  GET/PATCH `[id]`, POST `[id]/publish|cancel|complete`, GET/POST
  `[id]/assignments`) and `/api/v1/workforce/shift-assignments/[id]`
  (GET/PATCH withdraw). Multi-assignment per shift is allowed (the unique is
  per `(shift, employee)`; no headcount column).
  **Prior slice (`DEC-094` — the workflow platform, schema-only):** the
  spec'd `task`/`approval` platform tables (`DATA_DICTIONARY` §9) with the
  `DEC-101` provisional clarifications (12 items); no application or web
  port; the `job` table, worker/scheduler and outbox layer stay **gated on
  `ADR-0004`** (still `Proposed`). Full detail in the work log.
  **Prior slice (programme step 20b — `DEC-088`/`DEC-100`,
  `DOC-001`…`DOC-004`, committed `2784f18`…`838d11a`):** the staff document
  library — the programme's first versioned entity: `document` (`title`,
  `category`, `audience`, `status ∈ {draft, published, archived}` default
  `draft`, plain-uuid `owner_id`, audit columns), `document_version`
  (`document_id` FK, `version_no` integer > 0 — avoiding the `auditColumns()`
  `version` row-counter collision, the API field is `version`; nullable real
  `file_object_id` FK per `DEC-085`; nullable `notes`/`published_at`/
  `published_by`; `UNIQUE (document_id, version_no)`; the all-or-nothing
  `document_version_published_check`) and `document_acknowledgement`
  (`document_version_id` FK, `acknowledged_by`, `acknowledged_at`,
  `UNIQUE (document_version_id, acknowledged_by)`, no audit columns). Three
  cross-org coherence guards raising `23514`. Version model: publish stamps
  both fields together via an explicit command, only the highest-numbered
  version may publish, the **current published version is the greatest
  _published_ version** (the real `DOC-002` bug — a newer _unpublished_
  version hiding the still-current published version — found in review and
  fixed via `findCurrentPublishedVersion`); status lifecycle: draft →
  published (through a version only), archived terminal, repeat archive a
  true no-op. Access: read = all nine roles on published `all_staff`
  documents; manage = owner, general_manager, location_manager, admin; a
  non-manager sees only the current published version. Concurrency: version
  creation and publication lock the parent `document` row (`SELECT … FOR
UPDATE`). The API is `/api/v1/documents/**` and
  `/api/v1/document-versions/**`.
  **Schema:** migrations through **`0056`**; **87 tables** (was 86). Next free
  decision id **`DEC-105`**.
  **Reviews and reconciliation (row 14a, condensed).** Both reviewers
  independently found the same blocker (withdrawing an `approved` assignment
  on a `completed`/`cancelled` shift executed an illegal terminal transition
  — fixed: withdrawal rejects unless the shift is `assigned`); majors fixed
  (`role_code` matching in `assignShift`; `cancelShift` orphaning an
  `approved` assignment); minors fixed (`updateShift` locking; the
  double-withdraw race). Recorded in `DEC-102`, not fixed: the
  dictionary's `shift.created_by` satisfied by the nullable plain-uuid audit
  `created_by`; `shift_assignment`'s audit columns a convention;
  multi-assignment per shift; the list orderings not fully index-covered;
  `role_code` free text. Full detail in the row-14a work-log entry.
  **Reviews and reconciliation (row 14b-1).** Both reviewers found **no
  blocker**. Majors, both **accepted + fixed**: the adjustment GET/POST was
  gated on the rota read roles, leaking the payroll-input hours to
  kitchen/FOH — now `WORKED_HOURS_READ_ROLES`/`WRITE_ROLES`; `adjusted_hours`
  above the `numeric(9,2)` range raised an unhandled `22003` (500) — now
  capped in the command and the parser (400/`DomainError`). Minors,
  **accepted + fixed**: the report's latest-adjustment tie-break disagreed
  with `listShiftAdjustments` (now both `created_at desc, id asc`); the
  report joins now org-scope `shift`/`employee` explicitly (defence in
  depth). Recorded in `DEC-103`, not fixed: the single-stage approval model
  (the actor is the approver; the nullable pair supports a future two-stage
  flow but none is implemented); `analyst` excluded from the worked-hours
  report (the matrix's "Aggregate" is unimplemented — an open point); the
  report is not persisted; the retention period. Both reviewers verified the
  `0053` SQL matches the schema, the `0054` guard is correct, the decimal
  derivation is float-free with HALF_UP at 2dp, the `[from, to)` window and
  latest-adjustment subquery are correct, and the down path is FK-safe. (The
  `DEC-094` review outcome — no blockers, the decide-once fix — is in the
  work log.)
  **Schema:** migrations through **`0056`**; **87 tables** (was 86). Next free
  decision id **`DEC-105`**.
  **Verification:** `typecheck`, `lint`, `format:check`, `build` clean;
  **2830/2830 tests with `DATABASE_URL`** (196 files); `npm audit --omit=dev`
  = 0; `db:migrate` through `0056` is a no-op on re-run; **87 tables**;
  organization-scoped everywhere (`DEC-061`).
  **Also delivered earlier (the `DEC-087` workforce `employee` +
  personnel-documents slice, the `DEC-089` HMS monitoring slice, the `DEC-090`
  incidents slice, the `DEC-091` checklists slice, the `DEC-092`
  equipment/maintenance slice and the `DEC-093` compliance export slice — full
  detail in "Reversibility" and the work log):** the fridge/freezer monitoring
  register + append-only reading logs (migrations `0037`–`0039`), the incident
  register + corrective actions (migrations `0040`/`0041`), the checklist
  templates + runs (migrations `0042`/`0043`), the equipment register +
  maintenance log (migrations `0044`/`0045`) and the storage-free JSON
  evidence bundle (`GET /api/v1/hms/compliance-export`, **no migration**);
  `ADR-0006` accepted 2026-09-21; the storage integration (Spaces client /
  signed URLs / retention enforcement) stays deferred. The **HMS half of the
  programme is complete**.
  **Dev server (session-scoped):** the previous session ran http://localhost:3000
  with `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
  `ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in `owner` /
  `LocalDevPass123`; MFA is disabled for `owner` (no TOTP key needed); demo
  data is seeded including the `zettle-legacy` `import_profile`
  (`profile_version` `i19-v1`, `posting_policy` `allow_partial`); a fresh
  session must restart the server.
  Remaining roadmap: the HMS/personnel-documents programme (Phase 6 + Epics
  20/21 — `DEC-086`…`DEC-094`) is approved; the **HMS half is complete**, the
  **workforce-documents half is complete** (row 20a — the `employee` entity +
  personnel documents, `DEC-087`/`DEC-099`; row 20b — the staff document
  library, `DEC-088`/`DEC-100`), the **workflow platform is delivered**
  (`DEC-094`/`DEC-101` — the `task`/`approval` tables, schema-only; the
  `job`/worker/outbox layer gated on `ADR-0004`), **row 14a shift
  scheduling is delivered** (`WF-002`/`WF-003`, `DEC-102` — `shift` +
  `shift_assignment` with the full application + web port), **row 14b-1
  worked hours are delivered** (`WF-004`, `DEC-103` — `shift_adjustment` +
  the `computeWorkedHours` derivation/report with the full application +
  web port) and **row 14b-2 is delivered** (`WF-005`, `DEC-104` —
  `payroll_report` with the snapshot/application/web port):
  **row 14 is complete**; the next build
  slices are the **receipt→ledger wiring** (gated on the OPS destination
  `storage_area_id` policy — a recorded owner input) and **row 13 — close +
  dashboards + menu engineering** (data-gated on history/grain quality,
  I11; the **WF-003 self-assignment login
  model** remains an open owner input).
  Beyond the programme: the receipt→ledger wiring needs the OPS destination
  `storage_area_id` policy; row 13 is data-gated
  on history/grain quality (I11); rows 15–18 blocked (data /
  `ADR-0009`–`0011`); the deployment rehearsal is parked on owner inputs; the
  golden fixtures are unsigned. Programme direction (user instruction):
  proceed autonomously — review/fix, document status + next steps, commit,
  then the next unblocked task. Nothing has been applied to DigitalOcean.
- **Auth complete and security-reviewed (slices 1a–1e):** domain primitives (1a);
  persistence layer (1b-i); application flow (1b-ii); password reset + access
  control (1b-iii, `2ce8847`; reset neutrality `5776914`); hardening (`60ac52e`:
  fail-closed MFA config, 32-byte key validation, `isAuthorizedFor` throws on an
  empty requirement, audit before/after the secret guard); the HTTP surface (1c,
  `5c42c1d`: routes, cookies, CSRF/same-origin, per-IP limiter, login/2FA/reset
  pages); TOTP enrolment + recovery codes (1d, `07af21d`); first-owner bootstrap +
  MFA enrolment surface (1e, `e51a957`); atomic MFA disable + bootstrap `--dry-run`
  (`0cce93b`).
- **Master data done:** slice 2 — unit + supplier-pack value objects (`87f9ced`,
  strict package-to-base fix `4ccfb23`); slice 3 — master-data schema + conversion
  graph (`a869227`, migration `0004`), `unit_conversion` overlap invariants
  (migration `0005`) + conversion-graph hardening and `DEC-050`/`DEC-051`
  (`b8897bf`).
- **Costing slices done:** slice 4 — receipt + price history + landed cost —
  done (`e3706c0`, including its review fixes and migrations `0007`/`0008`,
  `DEC-052`); slice 5 — recipes / sub-recipes / version / yield / allergens — done
  (`841da96`/`13a29b7`/`15b9b68`, migration `0009`, `DEC-052`–`DEC-054`; its two
  adversarial reviews were reconciled in `13a29b7`/`15b9b68`); slice 6 — operating
  costs + labour + allocation — **committed** (`8f3ac5d`, migrations `0011`–`0013`,
  `DEC-055`–`DEC-057`); slice 7 — cost card + snapshot + price scenario + approval —
  **committed and reviewed** (`400c95b` + review-fix commits `60f3ec5`, `c82a30f`,
  `083106a`; migrations `0014`–`0016`; domain `pricing.ts`/`cost-card.ts`,
  application `CostCardStore`/`PriceScenarioStore`; `DEC-058`–`DEC-060`; its three
  adversarial reviews were run and reconciled — see the work log). `c82a30f` added
  cross-organization guards to `calculateCostCard`/`calculatePriceScenario` and
  documented `0015`/`0016` in the migration runbook; `083106a` wired the pinned
  pricing primitives into the scenario outcome, removed two dead read APIs,
  de-duplicated the contribution boundary and added the `0014`/`0016` pre-apply
  preflight notes.
- **UI foundation:** design tokens package (`aa2eff5`), token-driven UI primitives
  (`a83a312`), layout reference note (`dad2ff0`), accessibility/form-wiring fixes
  (`74ac467`).
- **Decision briefs + cost estimate:** DEC-049 assessment (`c8e86e0`), deployment
  cost estimate (`21e9c72`), multi-tenancy posture (`018930d`), jobs-runtime
  comparison recommending pg-boss (`3505aa8`), runbook pre-apply inputs
  (`bfc5f74`).
- **DEC-049 closed:** drizzle-orm 0.45.2 / drizzle-kit 0.31.10 upgrade (`cc86f13`);
  `npm audit --omit=dev` = 0.
- **Tests:** without `DATABASE_URL` the integration tests skip; with it
  **2830/2830 passed** (196 files) — recorded 2026-09-22 at the
  row-14b-2 payroll-report tree (all checks pass; `db:migrate` through
  `0056` is a no-op). Re-verify with `npm run test` and update if they differ.
  Open verification debt: the per-process rate limiter needs a shared
  store before multi-instance deployment; the reset-token delivery is a no-op stub
  until the email slice; the palette hex values and data-viz palette semantics
  await owner sign-off (see "Open decisions / inputs"); the six golden fixtures
  remain unsigned and are the "verified" gate.
- **Persistence core + deployment foundation (committed):** Drizzle schema,
  migrations `0000_enable_extensions` → `0056` additive with tested down paths
  (`0011_cost_allocation.sql` adds the four slice-6 tables; `0014_cost_card_pricing`
  adds four deferred `price_scenario` columns + `snapshot_component_kind_check`;
  `0015` adds `calculation_snapshot_cost_card_index`; the hand-written `0016` adds
  the `cost_card_approved_scope` invariant — a partial unique
  `cost_card_approved_scope_key` (`NULLS NOT DISTINCT WHERE state = 'approved'`);
  `0018` scopes the stock-movement idempotency key per organization and `0019`
  adds the `stock_movement_org_occurred_idx` as-of index; `0020` adds the
  slice-9 stock-ops tables (`stock_count`/`stock_count_line`/`stock_transfer`,
  `stock_movement.transfer_id`) and extends the source guard; `0021`
  adds the slice-10 production tables (`production_plan`, `production_batch`,
  `production_batch_input`, `production_batch_output`,
  `waste_event.production_batch_id` FK) and extends the source guard to
  `production_batch`; `0022` adds the row-11 tables
  `import_run`/`import_staging_row`/`external_mapping` and vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`; **`0023`**
  adds the row-12 tables `sales_transaction`/`sales_line`/
  `settlement`/`reconciliation`, vocabularies `RECONCILIATION_STATUS`/
  `OPTION_KIND` and the `sales_line` branch in `stock_movement_source_guard`
  (all committed, `2104068`/`77d913e`); **`0024`–`0026`** add the
  `reconciliation_tolerance` table + EXCLUDE constraint (`0024`), the
  `MAPPING_STATE` `conflict` value (`0025`) and the
  `sales_line_reversal_of_id_key` partial unique index (`0026`; committed in
  `6ff5881`); **`0027`** adds the `price_version` table (half-open
  `[effective_from, effective_to)` for PRICE-002/003, non-overlapping per
  `(organization_id, product_variant_id, location_id, channel_id)` via a
  hand-written EXCLUDE with a COALESCE sentinel; committed in `414832b`);
  **`0028`** adds the `DEC-078` check constraints
  `settlement_status_check` and `reconciliation_scope_type_check` (the
  `{received, paid, void}` and `reconciliation_scope_type` vocabularies;
  committed in `ed93288`);
  **`0029`** enforces cross-organization coherence on the recipe/receipt
  FKs via `BEFORE INSERT OR UPDATE` guard triggers (`recipe_allergen.
 allergen_id`, `recipe_line.item_id`/`sub_recipe_id`,
  `goods_receipt_line.supplier_item_id` — the receipt-line guard also
  enforcing the supplier and item match) plus the deferred single-column
  FK on `goods_receipt_line.supplier_item_id` (`NOT VALID` → `VALIDATE`;
  committed in `9d0e055`);
  **`0030`** adds the `data_quality_exception` table (`rule_code`,
  `severity ∈ {low, medium, high, critical}` default `medium`,
  `entity_type`/`entity_id` polymorphic, `detected_at`, `owner_id`,
  `due_date`, `status ∈ {open, acknowledged, resolved, dismissed}` default
  `open`, `resolution`; committed in `d1d0fad`);
  **`0031`** adds the `DEC-081` `import_profile` table (keyed
  `(organization_id, source)` unique, `profile_version`, `posting_policy`
  checked against `import_posting_policy`, `validation_rules` jsonb object) and
  a nullable `import_run.import_profile_id` FK, and **`0032`** adds the
  `import_run_profile_org_guard` `BEFORE INSERT OR UPDATE` coherence trigger
  (committed in `f4a8110`); **`0033`** adds the `DEC-083` `import_disposition`
  table (FK → `import_staging_row` `ON DELETE cascade` +
  `UNIQUE(import_staging_row_id)`, `disposition` checked
  `{unmapped, rejected, ignored}`, required `actor_id`, no `organization_id` —
  scoped through `import_staging_row` → `import_run`) with the journalled jsonb
  backfill and the lossless unjournaled down that rebuilds
  `diagnostics.dispositions` from the table before dropping it (committed in
  `dbb7d97`;
  **`0035`** adds the `DEC-085` `file_object` platform table (`id`,
  `organization_id` FK, `storage_key`, `filename`, `mime`,
  `size_bytes bigint >= 0`, `checksum_sha256`, `retention_policy`
  provisional free text, `uploaded_by` (deferred `app_user` FK),
  `uploaded_at`, `linked_entity_type`/`linked_entity_id` polymorphic) with
  `UNIQUE (organization_id, storage_key)` and the deferred
  `import_run.file_object_id` FK (`NOT VALID` → `VALIDATE CONSTRAINT`);
  **`0036`** adds the `file_object_org_guard` `BEFORE INSERT OR UPDATE`
  coherence trigger (the `DEC-079`/`DEC-081` precedent);
  **`0037`** adds the `DEC-089` HMS tables `monitoring_point` +
  `monitoring_reading` (readings decimal-only `numeric(19,6)`),
  **`0038`** the append-only triggers incl. a TRUNCATE guard (only `notes`
  amendable) and **`0039`** the cross-org coherence guards (the
  `DEC-079`/`DEC-081` precedent);
  ledger through `0049` (`0040` the `DEC-090` incident +
  corrective-action tables, `0041` their coherence guards, `0042` the
  `DEC-091` checklist tables, `0043` their coherence guards, `0044` the
  `DEC-092` equipment/maintenance tables, `0045` their coherence guards,
  `0046` the `DEC-087` `employee` + `employee_document` tables, `0047` the
  four workforce coherence guards — committed `59ad19e`/`5b932a8` — and
  `0048` the `DEC-088` `document`/`document_version`/
  `document_acknowledgement` tables, `0049` the three staff-document
  coherence guards — committed `ee47947`, runbook `838d11a` — and `0050` the
  `DEC-094` `task`/`approval` workflow-platform tables — committed
  `c90a45a` — and `0051`/`0052` the row-14a `shift`/`shift_assignment`
  tables + the three shift coherence guards — committed `f3a990b` — and
  `0053`/`0054` the row-14b-1 `shift_adjustment` table + its coherence
  guard — committed `a67fe49` — and `0055`/`0056` the row-14b-2
  `payroll_report` table + its partial-unique/org guard — committed
  `f17fb29`);
  the `asset`
  register is deliberately deferred — note `DEC-092`'s `equipment` is a
  distinct HMS register, not the finance `asset`), the
  advisory-locked migrator, worker/scheduler
  stubs and the `infra/` Terraform scaffold validated offline. Not applied.
- **Not yet built:** row 13 (close + dashboards + menu engineering —
  data-gated on history/grain quality, I11), the
  receipt→ledger wiring (gated on the OPS destination `storage_area_id`
  policy — a recorded owner input) and
  rows 15–18
  (blocked: data / `ADR-0009`–`0011`); also
  the deferred tables
  (the `employee`,
  `employee_document`, `document`, `document_version`,
  `document_acknowledgement`, `task`, `approval`, `shift`,
  `shift_assignment`, `shift_adjustment` and `payroll_report` tables have
  landed (row 14 is complete) —
  integrations, competitor, AI,
  procurement, period close, the platform `job` table (gated on `ADR-0004`),
  and the
  five deferred file FKs (`goods_receipt.evidence_file_id`,
  `cost_observation.receipt_file_id`, `operating_cost.evidence_file_id`,
  `settlement.source_file_id`, `waste_event.photo_file_id`) stay plain uuids
  — `file_object` itself now exists (`DEC-085`, migration `0035`) — and the
  `asset` register).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0,
1a–1e and 2–12 done, incl. row 11 and row 12 and the `DEC-081` import-profile
slice, the `DEC-082` posting-policy enforcement, the `DEC-083`
dispositions-table slice with its `0034` contract step, the `DEC-084`
variance-producer slice and the `DEC-085` `file_object` slice —
**row 11 is complete**; the `DEC-072`–`DEC-095`
decisions + low-risk implementations are done,
committed `aaec400`–`8b22468` plus the slice commits; the new programme
(Phase 6 + Epics 20/21, `DEC-086`…`DEC-094`) is approved and its first seven
build slices — HMS monitoring points + readings (`DEC-089`), HMS
incidents + corrective actions (`DEC-090`), HMS checklists (`DEC-091`),
HMS equipment/maintenance (`DEC-092`), HMS compliance / evidence export
(`DEC-093`), the workforce `employee` + personnel-documents slice
(`DEC-087`) and the staff document library (`DEC-088`) —
are **delivered** (the HMS half and the workforce-documents half of the
programme are complete), the **workflow platform (`DEC-094`/`DEC-101` —
the `task`/`approval` tables, schema-only) is delivered**, **row 14a
shift scheduling (`shift` + `shift_assignment`) is delivered**,
**row 14b-1 worked hours (`shift_adjustment` + the worked-hours
derivation/report) is delivered** and **row 14b-2 `payroll_report`
(`WF-005`, `DEC-104`) is delivered — row 14 is complete**;
further original rows are
gated — row 13 on data (I11),
rows 15–18 on data/ADRs; the receipt→ledger wiring is the lead item
(gated on the OPS destination `storage_area_id` policy); else row 13).
The list below is the short narrative form.

1. **Receipt→ledger wiring — the lead item, gated:** on the **OPS receipt
   destination `storage_area_id` policy** — a recorded owner input. If it
   has not landed, it stays blocked; do not resolve the policy silently
   (goods-receipt acceptance is not yet wired to the ledger — the
   receipt→movement integration and its storage-area policy are
   unresolved, `post-stock-movement.ts`; see the slice-8 roadmap entry).
2. **Row 13 — close + dashboards + menu engineering** — `ADR-0007` is
   accepted (2026-09-20); **data-gated** on history/grain quality (I11) —
   synthetic fixtures until real data; `DEC-027` monthly period
   lock/close is the close half. Row-14 residuals remain open inputs
   (do not block development): the **WF-003 self-assignment login input**
   (owner; self-assignment stays deferred, no self-assign endpoint) and
   the **`DEC-102`/`DEC-103`/`DEC-104` provisional items** awaiting
   owner/OPS confirmation; the privacy-review retention periods per
   file class
   (rows 15–18 remain blocked: data / `ADR-0009`–`0011`).
3. **New open points from the staff-library, workforce, export, equipment,
   checklists and incidents slices (recorded, do not resolve silently):**
   from the staff-library slice — `document` has **no location column**, so
   `DOC-001`'s "readable by all active staff **at authorized locations**" is
   unenforceable (the library is organization-wide); the **acknowledgement
   retention period per file class** (a privacy-review input); **no
   un-archive** (archived is terminal); the **`DEC-100` provisional items**
   awaiting owner/OPS confirmation; the storage path deferred (`DEC-085` —
   no bytes, no signed URLs, no retention enforcement) and `file_object` has
   **no application port**; the `reviewer-glm` step-capped web route
   test-assertion coverage gap; noted, no action: the
   `findLatestDocumentVersion` dual semantics, the latent acknowledge-command
   audience check, and the `document_status_check` naming vs the generic
   `document_status` vocabulary. From the workforce
   slice — `WF-007`'s audited upload/replace **and retention** is not
   implementable while `DEC-087` defers the storage path (the bytes cannot be
   uploaded, downloaded, scanned or retention-enforced; there is no storage
   client, no signed URLs, and `file_object` has **no application port at
   all**); retention periods per file class remain a privacy-review input;
   there is **no version model** for personnel documents (a `supersedes_id`
   chain is the upgrade path); `role_code` has no CHECK;
   `employee.cost_center_id` is a plain uuid (the cost-centre FK stays
   deferred); no un-retire/delete path; the provisional NULL-`primary_location_id`
   fail-closed rule; location scope enforced in the web layer only; the fake's
   codepoint ordering vs Postgres collation for non-ASCII names. From the
   export slice — the
   export's **DB-side location push-down** (the per-source cap is applied
   org-wide then filtered in memory, so a scoped caller can still get an
   incomplete bundle — now honestly flagged via `truncated`); **no
   personal-data minimization/redaction** (privacy review; a
   `personalDataFields` list is the declared contract); the bundle is **not
   persisted**, so no retention class applies yet (a persisted artifact's
   class/period stay open — `DEC-093`, `ADR-0006:47`); a **partial bundle for
   `analyst`** is not implemented (fail-closed); a **regulator-final format**
   (CSV/ZIP, per-regulator shapes) is a later slice; evidence **file bytes /
   signed URLs** stay deferred (`DEC-085`/`ADR-0006`); the **period column
   choices remain provisional**; the `DEC-098` provisional items; the
   `reviewer-glm` export-period coverage gap. From the equipment slice — the
   **systemic driver-error mapping** (a bad FK/check id → 500 instead of
   400/404; the proposed single root-cause fix is in `mapErrors`); the
   **unused audit columns on fact logs** (`maintenance_log` carries
   `updated_at`/`updated_by`/`version` it never sets — uniform convention);
   ISO instants requiring seconds; command-level `limit`/`offset` range
   checks; the `reviewer-glm` coverage gap; `maintenance_log` has no
   `location_id` (the `corrective_action` ceiling); `equipment.kind` is free
   text pending an owner/OPS vocabulary; `maintenance_log` has no DB
   immutability trigger (create+read-only is enforced only in the
   repository); the `DEC-097` provisional items awaiting owner/OPS
   confirmation; and the two requirement-vs-decision conflicts (`HMS-007`/the
   UI require the export to cover maintenance while `DEC-093` enumerates only
   readings, checklist runs, incidents and corrective actions; `HMS-001`
   implies a `task`/`approval` link that `DEC-092`/`DEC-094` never define).
   From the checklists slice — no completeness rule
   for a `completed` run (it may omit an item's result), no per-item
   evidence, and no failed-item → `corrective_action` link; the provisional
   jsonb 500-element ceiling; list-filter values not vocabulary-validated;
   route tests not exercising `withMutationGuards`; a multi-location scope
   filter can return a short page; no scheduling (due dates/reminders/
   assignment stay with the `task`/`approval` tables, which now exist
   (`DEC-094`) but have no application/web layer yet); the `DEC-096`
   provisional items awaiting owner/OPS confirmation. From the incidents
   slice: the **corrective-action location-scope ceiling**
   (`corrective_action` has no `location_id`; a scoped caller must supply
   `incidentId`, and a reading-linked action is fail-closed 403 — upgrade
   path: a `location_id` column or a location-joined query); `involves_personal_data`
   stored but inert until the privacy review; the `DEC-095` provisional
   items (severity vocabulary, incident `owner_id`/`due_date`, the
   Kitchen/FOH record-vs-read reading, evidence shape, no state-machine
   coupling) awaiting owner/OPS confirmation; the `reviewer-glm`
   step-capped coverage gap; carried over from the monitoring slice — the
   **systemic location-scope gap** (HMS first; the other routes do not pass
   `locationId` to `isAuthorizedFor`); the **audit-write transaction
   binding** (`writeAudit` closes over the parent `db`); the
   **`notes`-amendment audit trail**; duplicate readings at the same
   instant are **intentional**.
4. **Owner/OPS/data inputs** (gate the remaining roadmap items): the **OPS
   receipt destination `storage_area_id` policy** (unblocks the receipt→ledger
   wiring); the **FIN variance-tolerance thresholds** (un-provisionalises the
   `DEC-084` producers); the **privacy-review retention periods per file
   class** (personnel documents, incident register, acknowledgements);
   **history/grain quality
   (I11)** (unblocks row 13); the **deployment prerequisite inputs** (see
   item 8) and the **six golden-fixture signatures** (see
   below).
5. **Receipt→ledger wiring** — now the lead item (see item 1); gated on the
   OPS destination `storage_area_id` policy.
6. **Row 13 — close + dashboards + menu engineering** — now item 2.
7. **Row 14 — workforce/scheduling — complete (14a + 14b-1 + 14b-2):** 14a
   (`shift` + `shift_assignment`) is
   **delivered** (`DEC-102`, migrations `0051`/`0052`); 14b-1
   (`shift_adjustment` + worked hours) is **delivered** (`DEC-103`,
   migrations `0053`/`0054`); 14b-2 (`payroll_report`) is **delivered**
   (`DEC-104`, migrations `0055`/`0056`); the **WF-003 self-assignment
   login model** remains an open input
   (rows 15–18 remain blocked: data / `ADR-0009`–`0011`).
8. **Test-deployment rehearsal** — per `docs/runbooks/deployment.md`, staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite inputs
   (see "Open decisions / inputs" — a scoped `DIGITALOCEAN_TOKEN`, a private
   Spaces state bucket + credentials, the sanitized-data/clone decision,
   `ADR-0004` acceptance, the legacy instance-slug check).
9. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
10. **Remaining small unblocked TECH open points (recorded, unscheduled — take
    one only if asked):** the reset-token delivery stub (until the email
    slice); the 13 unexported `schemas/domain-enums.yaml` keys (intentional —
    the `UNEXPORTED_YAML_KEYS` guard tracks them); owner-gated: the unit
    `m`/`length` dimension; the palette hex values.
11. **Deployment foundation — scaffolded and validated offline (committed); not
    applied.** `infra/` Terraform (project, database, spaces, networking,
    app-platform, monitoring, dns) + the App Platform app spec are done, and the
    `apps/worker` / `apps/scheduler` stubs exist. The jobs runtime (`DEC-062`,
    pg-boss) and the multi-tenancy posture (`DEC-061`) are now decided. The env-var
    wiring is done and committed (`583da3f`): `ORGANIZATION_ID` and
    `TOTP_SECRET_ENCRYPTION_KEY` are wired conditionally into the app-platform
    module and both env roots; the offline plan is still **16 to add / 0 change / 0
    destroy** per env. Before any `apply`: the decisions under "Open decisions /
    inputs", real DO credentials and a provisioned Spaces state bucket, and a
    single-runner apply. See
    `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
    `docs/runbooks/deployment.md`.
12. **Costing verification** — against `docs/phase0/CALCULATION_CONTRACT.md` with
    synthetic fixtures, then real data; **owner sign-off of the six golden
    fixtures** (`docs/phase0/GOLDEN_FIXTURES.md`, prepared per `DEC-065`) is the
    gate for treating any cost as "verified" (slice 7 surfaces the sign-off trail).
    Still unsigned.

## Open decisions / inputs (do not block development)

- **Recorded this session (2026-09-22, from the row-14b-2
  payroll-input-report slice reviews and reconciliation; recorded, not
  decided — do not resolve silently):** the **`DEC-104` provisional items**
  still need owner/OPS confirmation: the **"remaining planned shifts run
  as scheduled"** assumption is **not** implemented (only
  `{assigned, completed}` shifts count, so a pre-month-end report
  under-counts — the biggest open item); whether the **base or loaded**
  hourly rate is intended (`base_hourly_rate` used today, a
  `ponytail:`-noted simplification); `currency` is hard-coded `NOK`; the
  `draft` status is unreachable through the API; the `DEC-027` monthly
  period-lock interaction; the working-time retention period; the audit is
  application-layer-only. **Also recorded:** the access asymmetry —
  `location_manager` is deliberately excluded from
  `PAYROLL_REPORT_READ/WRITE_ROLES` (the matrix says None) although the
  worked-hours report grants it. The `payroll_report` slice is
  **delivered** — **row 14 is complete** (`WF-005`; migrations
  `0055`/`0056`; **87 tables**; committed `f17fb29`…the roadmap update).
  Next free decision id **`DEC-105`**.
- **Recorded this session (2026-09-22, from the row-14b-1 worked-hours
  slice reviews and reconciliation; recorded, not decided — do not resolve
  silently):** the **`DEC-103` provisional items** still need owner/OPS
  confirmation: the **single-stage approval model** for `shift_adjustment`
  (the actor is the approver; the nullable `approved_by`/`approved_at` pair
  supports a future two-stage flow but none is implemented); the
  **`analyst` exclusion** from the worked-hours report (the access matrix
  grants "Aggregate", but no aggregate projection exists in the MVP and the
  row-level report would expose individual hours — an open point); the
  worked-hours report is **not persisted** (computed on demand; no
  artifact, no retention class); the **working-time retention period**
  (do not resolve the privacy-review retention periods silently). **And
  the row-14b-2 inputs** for the next slice's `DEC-104` provisional
  clarification: the `payroll_report.snapshot` JSON shape/rounding/
  expected-pay formula (hours × `base_hourly_rate`, decimal-only); the
  monthly period boundary and the "remaining planned shifts run as
  scheduled" assumption; the status transitions (`draft → generated →
exported → superseded`) and regeneration/supersede semantics; the
  "~3 days before month-end" trigger (the `job`/scheduler is
  `ADR-0004`-gated, so the report is generated on demand);
  `payroll_report.export_file_id` (a deferred `file_object` FK, `DEC-085`);
  the working-time retention period. **Also still carried: the `DEC-102`
  provisional items** awaiting owner/OPS confirmation (the provisional
  shift state machine (`open → published → assigned → completed`,
  `open|published → cancelled`, terminal `completed`/`cancelled` — no
  `05_WORKFLOWS.md` flow existed); manager
  assignment only, with **self-assignment (`self_assigned`/
  `pending_approval`/`rejected`) deferred** pending the **WF-003
  self-assignment login model** (must a self-assigning employee hold an
  `app_user` login? — an open owner input); the dictionary's
  `shift.created_by` (NOT NULL FK `app_user`) satisfied by the nullable
  plain-uuid audit `created_by`; `shift_assignment`'s audit columns are a
  convention; multi-assignment per shift (no headcount invariant); the
  `listShifts`/`listShiftAssignments` ordering not fully index-covered
  (harmless at MVP volume); `role_code` stays free text). **The row-14b-1
  worked-hours slice is delivered**
  (`WF-004`; `DEC-103`; migrations `0053`/`0054`; **86 tables**;
  committed `a67fe49`…`f49490a`). Next free decision id **`DEC-104`**.
- **Recorded this session (2026-09-22, from the `DEC-094` workflow-platform
  slice reviews and reconciliation; recorded, not decided — do not resolve
  silently):** the **`DEC-101` provisional items** (12 workflow-platform
  clarifications) still need owner/OPS confirmation: free-text
  `task.type`/`task.priority` (no vocabulary in the spec; upgrade path is
  CHECK-backed vocabularies); `task_status` with **no transition guard**
  (any status transition accepted — whether reopen should be constrained is
  open); `approval.decision` **nullable while pending** (the vocabulary has
  no `pending` value); **decide-once** with no amendment/re-decision path;
  plain-uuid actor columns (the `app_user` FK deferred); polymorphic
  targets + all-or-nothing linking (`task_linked_entity_check`);
  plain-uuid `created_from_event_id` (no outbox FK while `ADR-0004`-gated);
  no `task.location_id`; **access unset** — the `07_SECURITY_AND_NFR.md`
  matrix has no `task`/`approval` row, so no access rule is enforced yet
  (a recorded input for the consuming slice); mutable, not append-only; **no
  task↔approval link** (the `HMS-001` conflict, recorded not resolved); the
  `job` table/outbox not built (gated on `ADR-0004`, still `Proposed`).
  **And the row-14 inputs** recorded at the time — the shift and
  shift_assignment state machines, the `role_code` matching and the location
  scope for shifts are now **resolved provisionally by `DEC-102`** (row 14a
  delivered); still open: the **WF-003 self-assignment login model** (must a
  self-assigning employee hold an `app_user` login? — an open owner input)
  and the 14b items (the worked-hours derivation, the payroll-report
  snapshot shape/period, "Aggregate only" payroll visibility, the retention
  periods — do not resolve the privacy-review retention periods silently).
  **The `DEC-094` workflow-platform slice is delivered**
  (schema-only; `DEC-094`/`DEC-101`; migration `0050`; **83 tables**;
  committed `c90a45a`). Next free decision id **`DEC-103`**.
- **Recorded this session (2026-09-22, from the `DEC-088`
  staff-document-library slice reviews and reconciliation; recorded, not
  decided — do not resolve silently):** `document` has **no location column**,
  so `DOC-001`'s "readable by all active staff **at authorized locations**" is
  unenforceable — the library is organization-wide (owner/TECH input wanted on
  whether a location scope matters); the **acknowledgement retention period
  per file class** is a privacy-review input; **no un-archive path** (archived
  is terminal, per `DEC-100`); the **`DEC-100` provisional items** still need
  owner/OPS confirmation; the storage path stays deferred (`DEC-085` — no
  bytes, no signed URLs, no retention enforcement) and `file_object` has **no
  application port at all**; the `reviewer-glm` step cap truncated part of the
  web route test-assertion pass (a recorded coverage gap); noted, no action:
  the `findLatestDocumentVersion` dual semantics, the latent lack of an
  audience check in the acknowledge command, and the `document_status_check`
  naming vs the generic `document_status` vocabulary. The **real `DOC-002`
  bug** surfaced during reconciliation (a newer _unpublished_ version hid the
  still-current published version from staff and broke acknowledgement) was
  **accepted + fixed in-slice** (`findCurrentPublishedVersion` = greatest
  published version). **The `DEC-088` staff document library slice is
  delivered** (programme step 20b; `DEC-088`/`DEC-100`; migrations
  `0048`/`0049`; **81 tables**; committed `2784f18`…`838d11a`). Next free
  decision id **`DEC-101`**.
- **Recorded this session (2026-09-22, from the `DEC-087` `employee` +
  personnel-documents-slice reviews and reconciliation; recorded, not decided —
  do not resolve silently):** `WF-007` (Must) requires "audited
  upload/replace **and retention**", but `DEC-087` defers the storage path, so
  **the bytes cannot be uploaded, downloaded, scanned or retention-enforced** —
  there is no storage client, no signed URLs, and `file_object` has **no
  application port at all**; retention periods per file class remain a
  privacy-review input; there is **no version model** for personnel documents
  (a `supersedes_id` chain is the upgrade path); `role_code` has **no CHECK**
  (the vocabulary carries non-employee values); `employee.cost_center_id` is a
  plain uuid (the cost-centre FK stays deferred); **no un-retire path** and no
  delete path (retired, never deleted); the NULL-`primary_location_id`
  fail-closed rule is provisional; **location scope is enforced in the web
  layer only** (the systemic pattern); the fake sorts by JS codepoint while
  Postgres uses collation for non-ASCII names; plus the standing systemic
  points (the `writeAudit` transaction binding and the driver-error→500
  mapping). **The `employee` + personnel-documents slice is delivered**
  (programme step 20a; `DEC-087`/`DEC-099`; migrations `0046`/`0047`; **78
  tables**; committed `246c735`…`5b932a8`). Next free decision id
  **`DEC-100`**.
- **Recorded this session (2026-09-22, from the `DEC-093` HMS
  compliance/evidence-export-slice reviews and reconciliation; recorded, not
  decided — do not resolve silently):** the export's **DB-side location
  push-down** — today the per-source cap is applied org-wide and then filtered
  in memory, so a scoped caller can still receive an incomplete bundle (now
  honestly flagged via a conservative `truncated`, rather than silently);
  **no personal-data minimization/redaction** is applied in this increment — a
  privacy-review input; the bundle declares a `personalDataFields` list as the
  contract to shrink (`DEC-098` item 5 amended); the bundle is **not
  persisted**, so **no retention class applies to it yet** — a persisted
  export artifact's class and period remain open (`DEC-093`, `ADR-0006:47`); a
  **partial bundle for `analyst`** is not implemented (fail-closed); a
  **regulator-final format** (CSV/ZIP, per-regulator shapes) is a later slice;
  evidence **file bytes / signed URLs** stay deferred (`DEC-085`/`ADR-0006`);
  the **period column choices remain provisional** (one date column per source;
  the owner may prefer `completed_at`/`verified_at` for corrective actions);
  the `DEC-098` provisional items still need owner/OPS confirmation; the
  `reviewer-glm` step-capped coverage gap (it did not read part of the
  export-period test body in `hms.postgres.test.ts` or the persistence
  `*.postgres.test.ts` diffs). **The HMS compliance / evidence export slice is
  delivered** (programme step 19e; `DEC-093`/`DEC-098`; **no migration** — 76
  tables; the **HMS half of the programme is complete**). Next free decision id
  **`DEC-099`**.
- **Recorded this session (2026-09-21, from the `DEC-092` HMS
  equipment/maintenance-slice reviews and reconciliation; recorded, not
  decided — do not resolve silently):** the **systemic driver-error
  mapping** (a client-supplied nonexistent `fileObjectId` or any bad FK/check
  id surfaces as a **500** rather than a 400/404; the same holds for
  `equipment.location_id`, `checklist_run.template_id` and the
  incident/checklist slices, so the proposed root-cause fix is one shared
  mapping in `apps/web/lib/http.ts`'s `mapErrors` for driver FK/check
  violations — deliberately not patched per-route); the **unused audit
  columns on fact logs** (`maintenance_log` carries
  `updated_at`/`updated_by`/`version` from the uniform `auditColumns()` that
  a create+read-only log never sets — uniform convention, `checklist_run`
  has the same shape); ISO instants require seconds (stricter than RFC 3339,
  consistent with the repo's `assertIsoInstant`); command-level
  `limit`/`offset` range checks are absent (matches the existing routes);
  the `reviewer-glm` step-capped coverage gap (it did not read
  `equipment/[id]/maintenance-logs/route.test.ts`, `0044_equipment.sql`/its
  down, the snapshots beyond `0045`, the seed-helper bodies, or the
  pre-existing `hms.test.ts` sections); `maintenance_log` has **no
  `location_id`** (the `corrective_action` ceiling again); `equipment.kind`
  is **free text** pending an owner/OPS vocabulary; `maintenance_log` has
  **no DB immutability trigger** (create+read-only is enforced only in the
  repository); the `DEC-097` provisional items still need owner/OPS
  confirmation; and two requirement-vs-decision conflicts stay open —
  `HMS-007`/the UI require the compliance export to cover **maintenance**
  while `DEC-093`'s text enumerates only readings, checklist runs, incidents
  and corrective actions, and `HMS-001` implies a `task`/`approval` link
  that `DEC-092`/`DEC-094` never define. **The `DEC-092` equipment /
  maintenance slice is delivered** (programme step 19d; migrations
  `0044`/`0045`; 76 tables). Next free decision id **`DEC-098`**.
- **Recorded this session (2026-09-21, from the `DEC-091` HMS
  checklists-slice reviews and reconciliation; recorded, not decided — do
  not resolve silently):** template versioning is a `supersedes_id` chain
  but there is **no completeness rule** (a `completed` run may omit an
  item's result); **no per-item evidence**; and **no link from a failed item
  to a `corrective_action`** (`DEC-090`'s action FKs cover incidents and
  readings only). The jsonb **500-element ceiling is provisional**. List
  filter values are not vocabulary-validated (shared precedent); the route
  tests do not exercise `withMutationGuards` (shared debt); a multi-location
  scope filter can return a short page. **No scheduling** — `frequency` is
  stored on the template only, and due dates/reminders/assignment remain
  with the unbuilt `task`/`approval` tables (`DEC-094`), so nothing may
  depend on them. The **`DEC-096` provisional items** (category/status/
  outcome vocabularies, the `items`/`results` shapes, the checklist access
  extrapolation, the versioning approach) still need owner/OPS confirmation.
  **The `DEC-091` checklists slice is delivered** (programme step 19c;
  migrations `0042`/`0043`; 74 tables). Next free decision id **`DEC-097`**.
- **Recorded this session (2026-09-21, from the `DEC-090` HMS
  incidents-slice reviews and reconciliation; recorded, not decided — do
  not resolve silently):** the **corrective-action location-scope ceiling**
  (`corrective_action` carries no `location_id`, so a location-scoped
  caller must supply `incidentId` on the flat list, and a reading-linked
  action is fail-closed 403 for a scoped caller; the upgrade path is a
  `location_id` column or a location-joined query); `involves_personal_data`
  is stored but **inert** — a recorded privacy-review input, no behaviour
  until the privacy review lands; a standalone corrective action with
  neither FK link is allowed by `DEC-090` (by design); operators
  (kitchen/FOH) may mark an action `in_progress`/`done` but never
  `verified` (by design); the **`DEC-095` provisional items** (severity
  vocabulary, incident `owner_id`/`due_date`, the Kitchen/FOH
  record-vs-read reading, evidence shape, no state-machine coupling) still
  need owner/OPS confirmation; the **`reviewer-glm` step-capped coverage
  gap** (three route test files, `lib/guards.ts`/`lib/http.ts` internals,
  `incidents.postgres.test.ts`, the down migrations — the down paths and
  journal consistency were verified by `reviewer-qwen` and the persistence
  rehearsal).
  **The `DEC-090` incidents slice is delivered** (programme step 19b;
  migrations `0040`/`0041`; 72 tables). Next free decision id
  **`DEC-097`**.
- **Recorded this session (2026-09-21, from the `DEC-089` HMS monitoring-slice
  reviews; recorded, not decided — do not resolve silently):**
  (i) the **systemic location-scope gap** — the HMS monitoring-points routes
  are the **first route in the repo to enforce location scope**; the other
  routes do not pass `locationId` to `isAuthorizedFor`; closing the gap is a
  separate cross-cutting slice; owner/TECH;
  (ii) the **audit-write transaction binding** — the adapters' `writeAudit`
  closes over the parent `db`, so the audit fact is not strictly inside
  `withTransaction` (it mirrors every existing adapter; declined as a slice
  fix, recorded as systemic); a separate cross-cutting slice; owner/TECH;
  (iii) the **`notes`-amendment audit trail** — a `notes`-only update on a
  `monitoring_reading` succeeds (by design) but leaves no before/after
  history; whether an audit trail is wanted; owner/TECH;
  (iv) **duplicate readings at the same instant are intentional** — no
  dedupe/unique constraint on `(monitoring_point_id, measured_at)`; documented,
  no action.
  **The `DEC-089` monitoring slice is delivered** (migrations
  `0037`/`0038`/`0039`; 70 tables). Next free decision id **`DEC-095`**.
- **Approved this session (2026-09-21; the Phase A docs commit):** the owner
  approved a programme adding an **HMS & food-safety (IK-mat) module**,
  **employee personnel documents (contracts)** and a **staff document
  library** — recorded as **`DEC-086`…`DEC-094`**; scope amended in
  `01_PRODUCT_SCOPE.md` (the food-safety non-goal overturned); new
  requirement ids `WF-007`, `DOC-001…DOC-004`, `HMS-001…HMS-007` + phase
  map; delivery Phase 6 + Epics 20/21; access-matrix rows + retention notes
  in `07_SECURITY_AND_NFR.md`; new screens in `08_UI_UX.md`. Owner-agreed
  rules: contracts visible only to Owner + general_manager + admin (finance
  excluded); staff documents all-staff read published `all_staff` docs,
  managers publish (versioned, optional acknowledgement); full IK-mat
  package; privacy review approved. **Open inputs (recorded, do not
  decide):** the `ADR-0004` gate — accepting it (the named decider) is
  required before the `job`/worker/outbox layer of `DEC-094` (`task`/
  `approval` build now); the **WF-003 self-assignment login model** (must a
  self-assigning employee hold an `app_user` login?); the
  **privacy-review retention periods per file class** (personnel documents,
  incident register, acknowledgements). **Build order:** ~~HMS monitoring
  points + readings (`DEC-089`)~~ **delivered 2026-09-21** (see the bullet
  above) → ~~incidents + corrective actions
  (`DEC-090`)~~ **delivered 2026-09-21** → checklists/cleaning
  (`DEC-091`) → equipment/maintenance (`DEC-092`) → compliance export
  (`DEC-093`) → `employee` + personnel documents (`DEC-087`) → staff
  document library (`DEC-088`) →
  `task`/`approval` (`DEC-094`, job layer gated). Next free decision id
  **`DEC-096`**.
- **Resolved this session (2026-09-21, commits `bda0b6b` / `8b22468` /
  `02f7c33`):** the **`numeric(19,6)` digit cap** in `packages/domain/src/decimal.ts` —
  `parseDecimal` now rejects a value beyond the `numeric(19, scale)` storage
  precision (money `numeric(19,4)`, quantities `numeric(19,6)`, leading
  zeros excluded from the count) with the new
  `packages/domain/src/decimal.test.ts` (`bda0b6b`; `reviewer-glm` — no
  blocker/major, its boundary-test minor applied, the looser-than-`numeric(9,6)`
  rate/`numeric(19,10)` tax columns note recorded in the `ponytail:` note);
  the missing **`schemas/domain-enums.yaml` key for
  `IMPORT_DISPOSITION`** (`8b22468` — the canonical key added, the
  `YAML_ABSENT_VOCABULARIES` exemption removed (now empty, so the guard
  enforces every exported vocabulary has a yaml key), the provisional-mirror
  comments corrected; the `DEC-083`-review point (iii)); and the
  **`FakeCountStore.withTransaction` no-rollback fake-fidelity gap**
  (`02f7c33` — the fake now snapshots/restores the count + inventory +
  exception maps like `FakeProductionStore`, with a rollback test;
  `reviewer-glm` on the `decimal.ts` cap — no blocker/major, boundary tests
  added). No schema change (68 tables unchanged); no new decision — these
  execute recorded TECH open points. Next free decision id **`DEC-095`**.
- **Resolved this session (2026-09-21, `ADR-0006` + `DEC-085`):** the
  **file storage and retention** ADR is **accepted** by the owner in-session
  (revertible) — status `Accepted (2026-09-21)` in
  `docs/adr/0006-file-storage-and-retention.md`. The provider/region were
  already decided by `DEC-014` (DigitalOcean Spaces, Amsterdam AMS3); the
  **retention periods per file class** remain an open item for the privacy
  review. The `file_object` slice (row-11 import-framework point 6) is
  **delivered**: `DEC-085` accepted — the `file_object` table (migration
  `0035`) with the `import_run.file_object_id` FK and the
  `file_object_org_guard` trigger (migration `0036`); **row 11 is now
  complete**. Still deferred (recorded, not decided): the `file_object`
  **immutability/soft-delete posture**; the **five deferred file FKs**
  (`goods_receipt.evidence_file_id`, `cost_observation.receipt_file_id`,
  `operating_cost.evidence_file_id`, `settlement.source_file_id`,
  `waste_event.photo_file_id` — all plain uuids today); the **storage
  integration** (Spaces client / signed URLs / retention enforcement). Next
  free decision id **`DEC-095`**.
- **Resolved this session (2026-09-21):** the **`DEC-083` contract-step open
  point** is closed — the data-only migration
  `0034_import_disposition_contract` (commit `4326dec`) dropped the
  retained-frozen `import_run.diagnostics.dispositions` jsonb key from every
  run that still carried it (the other `diagnostics` keys untouched); the
  unjournalled down rebuilds the key from `import_disposition`; rehearsed
  locally (see "Work log"). **No new decision** — it executes accepted
  `DEC-083`; accepted decisions are not rewritten. The other three
  `DEC-083`-review points remain recorded (see the `DEC-083`-reviews bullet
  below). Tooling note: the root `db:generate` wrapper swallowed extra args
  (the runbook's documented `npm run db:generate -- --name=…` never named a
  migration) — fixed in `66b0d51`. No schema change (migrations through
  `0034`, still **67 tables**). Next free decision id **`DEC-085`**.
- **Resolved this session (2026-09-21, `DEC-084`):** the **`PROD-003`
  count-variance/yield-variance exception producers** are delivered
  **provisional** — `approveStockCount` records exactly one `count_variance`
  and `completeProductionBatch` one `yield_variance` `data_quality_exception`
  (entity the count/batch id; `detected_at` the fact instant; `severity` the
  schema default `medium`, provisional; one exception per document), written
  **unconditionally** through the `DEC-080` repository in the same transaction
  as the fact — no tolerance threshold is applied because the FIN
  variance-tolerance thresholds remain an open input (the `DEC-055`
  provisional-figures precedent; accepted provisional, TECH + FIN). The shared
  `data-quality` module (`packages/application/src/data-quality/`) was
  extracted and `transfers` refactored onto it (behaviour-preserving). No
  schema change (still **67 tables**, migrations through `0033`). Next free
  decision id **`DEC-085`**.
- **Recorded this session (2026-09-21, from the `DEC-084` reviews; recorded,
  not decided — do not resolve silently):** the **`FakeCountStore`
  `withTransaction` runs inline with no snapshot/rollback** (unlike
  `FakeProductionStore`), so a fake-store count test cannot assert rollback
  fidelity — a pre-existing fake-fidelity gap, not a regression; no test
  depends on it and the real transaction is covered by the Postgres
  `inRollback` integration tests. Not resolved.
- **Resolved this session (2026-09-21, `DEC-083`):** the **`import_disposition`
  table** is delivered — import dispositions moved out of the
  `import_run.diagnostics.dispositions` jsonb into a first-class table (FK →
  `import_staging_row` `ON DELETE cascade` + `UNIQUE(import_staging_row_id)` =
  one disposition per row, a repeat refused; `disposition` checked
  `{unmapped, rejected, ignored}`; required `actor_id`; no `organization_id` —
  scoped through `import_staging_row` → `import_run`, `DEC-061` via the join) —
  migration `0033` (additive, journalled, jsonb backfill with the keys retained
  frozen; lossless unjournaled down that rebuilds the jsonb from the table) plus
  the application wiring (`disposeStagingRow` writes via the table, the
  `getImportRun`/`previewImportRun`/`listImportRuns` readers, `postImportRun`'s
  `DEC-082` resolution and `reconcileImportRun`'s `DEC-035` close gate; the dead
  jsonb reader removed) (commits `4587564`/`dbb7d97`/`64a7cfc`/`0f8b7b1`).
  **67 tables.** The row-11 import-framework point 7 is closed; point 6
  (`file_object` absent) remains. Next free decision id **`DEC-085`**.
- **Recorded this session (2026-09-21, from the `DEC-083` reviews; recorded,
  not decided — do not resolve silently):**
  (i) ~~the frozen `diagnostics.dispositions` jsonb keys still exist and need a
  **contract/cleanup step** once nothing depends on them (tracked after
  `file_object`)~~ **resolved 2026-09-21** — the data-only migration
  `0034_import_disposition_contract` (commit `4326dec`) dropped the frozen
  key from every run that still carried it; the down rebuilds the key from
  `import_disposition`; rehearsed locally (see "Work log"); no new decision —
  it executes accepted `DEC-083`;
  (ii) the `import_disposition` **immutability/cascade posture** — whether it
  joins the append-only trigger set (`reject_immutable_change` on
  `stock_movement`/`calculation_snapshot`/`audit_event`) and whether the
  staging-row FK should cascade or restrict (today: cascade, by the
  pre-migration embedding precedent; a reject-immutable trigger set is a new
  invariant);
  (iii) ~~the `IMPORT_DISPOSITION` vocabulary has **no
  `schemas/domain-enums.yaml` key** (the `vocabularies.test.ts` exemption
  tracks it)~~ **resolved 2026-09-21** (commit `8b22468` — the canonical key
  added and the now-empty `YAML_ABSENT_VOCABULARIES` exemption removed);
  (iv) `createImportDisposition` is **not database-level org-guarded** (the
  application verifies the run and staging row org-scoped in the same
  transaction; persistence `create*` functions are conventionally not
  org-filtered; a guard would need a new migration).
  (Tooling note: the root `db:generate` wrapper swallowed extra args, so the
  runbook's documented `npm run db:generate -- --name=…` never named a
  migration — fixed in `66b0d51` by forwarding a trailing `--` args to
  drizzle-kit.)
- **Resolved this session (2026-09-21, `DEC-082`):** the `postImportRun`
  **posting-policy enforcement** is delivered — the run's recorded
  `diagnostics.posting_policy` snapshot governs (absent/blank →
  `allow_partial`; a present out-of-vocabulary value → `DomainError` as
  corrupt); under `all_or_nothing` a pre-write check refuses the whole attempt
  with a `DomainError` naming the blocking `sourceRowNo`s unless every staging
  row is postable, already linked to a sales line, or covered by an approved
  disposition (`DEC-035`), writing nothing and leaving the run's status
  unchanged (commits `12f0377`/`22b67c1`). No schema change (still 66 tables).
  The `DEC-081` "posting policy not enforced" point is closed. The row-11
  import-framework point 4 ("no import-profile table") was closed by `DEC-081`;
  point 7 (dispositions in `diagnostics.dispositions` jsonb, not a table) was
  closed by `DEC-083` (see above). Next free decision id
  **`DEC-085`**.
- **Resolved this session (2026-09-21, `DEC-081`):** the
  **import-profile table** is delivered — `import_profile` keyed
  `(organization_id, source)` (unique) carrying `profile_version`,
  `posting_policy` (default `allow_partial`, checked against
  `import_posting_policy`) and `validation_rules` jsonb (checked to be a jsonb
  object), plus a nullable `import_run.import_profile_id` FK — migrations
  `0031` (additive, generated) and `0032` (the
  `import_run_profile_org_guard` coherence trigger, the `DEC-079` precedent) —
  with the application wiring (`createImportRun` resolves the source's profile,
  `validateImportRun` merges the profile's rules under explicit caller rules)
  and the web layer (commits `2997587`/`f4a8110`/`e9ec176`/`1914795`/`cb3aff5`).
  The row-11 "no import-profile table exists" point is closed; the profile's
  posting policy is now **enforced** by `postImportRun` (`DEC-082`, committed
  `22b67c1`). Next free decision id **`DEC-085`**.
- **Resolved this session (2026-09-21, `DEC-080`, DQ-001):** the
  `data_quality_exception` table is delivered (migration `0030`) —
  `DEC-066`'s replacement for the interim `stock_transfer.discrepancy_note`
  and the natural home for count-variance and yield-variance exceptions
  (`PROD-003`) — with repository create/find/list/update and the first
  producer: `receiveStockTransfer` creates a `transfer_discrepancy`
  exception (severity `high`, entity `stock_transfer`, status `open`) in
  the same transaction as the receive, alongside the note (commits
  `40b5d7e`/`d1d0fad`/`ddc9e06`). The "no transfer-discrepancy exception
  table exists" point from the slice-9 open list is closed. Next free
  decision id **`DEC-085`**.
- **Resolved this session (2026-09-21, `DEC-079`, closing `DEC-054`):** the
  cross-organization referential-integrity / deferred-FK hardening is
  delivered — coherence on `recipe_allergen.allergen_id`,
  `recipe_line.item_id`/`sub_recipe_id` and
  `goods_receipt_line.supplier_item_id` is enforced by
  `BEFORE INSERT OR UPDATE` guard triggers (the `stock_movement_source_guard`
  precedent), not denormalized composite FKs plus a backfill; the
  receipt-line guard also enforces the supplier and item match;
  `goods_receipt_line.supplier_item_id` got its deferred single-column FK
  (`NOT VALID` → `VALIDATE`) — migration `0029` (commits `8376209`/`9d0e055`).
  The "deferred-FK hardening on `goods_receipt_line`" and "`DEC-054`
  cross-organization integrity on the recipe FKs" points from the surfaced
  lists are closed. Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-21, `DEC-078`):** the remaining low-risk
  vocabulary/integrity open points are delivered — `settlement.status`
  constrained to `{received, paid, void}` (default `received`),
  `reconciliation.scope_type` constrained to the new `reconciliation_scope_type`
  `{import_run, sales_source, settlement, supplier_invoice}` (migration `0028`
  check constraints; the "no settlement.status / reconciliation.scope_type
  vocabulary" point from the row-12 open list is closed) with
  `assertReconciliationScopeType` rejecting an unknown scope before any
  write; and `lotTracked` enforcement (the slice-8/9 "`lotTracked`
  unenforced" point is closed — a null-`lotId` posting is rejected for a
  lot-tracked item; the reversal path stays exempt because it mirrors the
  original lot).
  Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-21, `DEC-077`):** the price-version slice
  (`DEC-064`, PRICE-002/003) is delivered — the `price_version` table
  (migration `0027`, half-open `[effective_from, effective_to)`, non-overlap
  per scope via an EXCLUDE with a COALESCE sentinel; the "no `price_version`
  table" point from the slice-7 open list is closed) and approval-driven
  effective versions with the CAS `approvePriceScenarioIfApprovable` race fix.
- **Price-version scope resolution is exact-scope only (new, 2026-09-21;
  recorded not decided — do not resolve silently):** there is no
  company-wide (`null` location/channel) → specific-location/channel fallback
  in `findEffectivePriceVersion`; a company-wide version is a distinct "any"
  scope (per `DEC-077`) and does not currently
  resolve for a specific location today. Whether a fallback hierarchy is
  wanted (and its precedence) is an owner/TECH decision.
- **Resolved 2026-09-20 (`DEC-072`–`DEC-076`):** the
  effective-dated `reconciliation_tolerance` table (`DEC-072`, migration
  `0024` — the "no tolerance-configuration table" point is closed; precedence:
  explicit override → effective config at period end → explicit `DEC-026`
  default opt-in → block close); sales-line reversal semantics (`DEC-073`,
  migration `0026` — the `DEC-028` sales-line point is closed);
  `MAPPING_STATE` `conflict` (`DEC-074`, migration `0025`); `tax_rule_id`
  canonical with `applied_tax_rate` as the source-reported applied rate (A4,
  `DEC-075`, docs-only); the typed `NotFoundError` replacing the
  `/not found/i` message match (`DEC-076`). Next free decision id **`DEC-080`**.
- **Resolved this session (2026-09-20, previous session):** `ADR-0005` is **Accepted** (stock
  valuation/consumption — slice 8 unblocked); `ADR-0007` (reporting aggregates)
  and `ADR-0008` (integration ownership) are **Accepted** (2026-09-20,
  owner-delegated in-session, revertible) — rows 12 and 13 are no longer
  ADR-gated; their ADR **open items** remain recorded inputs (row 12's I1
  channel/SKU confirmations; per-integration ownership records, POS/Wolt API
  availability, allowed-operations approval); **`DEC-061`** multi-tenancy = shared
  schema with `organization_id` row scoping (RLS possible later; no schema/DB per
  tenant); **`DEC-062`** background jobs runtime = **pg-boss** over the existing
  PostgreSQL, worker/scheduler long-lived; **`DEC-063`** the price-scenario target
  is contribution over net price (a 6 dp fraction, not gross margin, not markup);
  **`DEC-064`** `price_version` + PRICE-002/003 are the next pricing slice after
  slice 8; **`DEC-065`** golden fixtures are machine-readable JSON under
  `tests/fixtures/` with the sign-off trail prepared; **`DEC-066`–`DEC-071`** the
  slice-9/10 technical defaults (transfer = header + paired movements, no line
  table; positive count variance via caller `unit_cost` → `item.current_cost`;
  waste valued at the ledger's moving average; production batch without a business
  number yet; recipe yield loss never posts waste; provisional
  `production_batch_output.kind` vocabulary).
- **Row-11 import-framework open points (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Row-11 import-framework open points"; recorded,
  not decided — do not resolve silently):** row 12 (sales + settlements +
  reconciliation) is now **committed** (`2104068`/`77d913e`; `ADR-0008` accepted
  2026-09-20, owner-delegated) and row 13 is no longer ADR-gated
  (`ADR-0007` accepted 2026-09-20) — history/grain quality remains the data
  gate; the I1 channel/SKU confirmations remain recorded owner inputs.
  Remaining items: the
  sales/consumption grain ambiguity (`DEC-009` daily-per-location vs a single
  `sales_line` `source_id`, FIN+TECH);
  ~~no import-profile table (TECH)~~ resolved 2026-09-21 (`DEC-081` — the
  `import_profile` table, migrations `0031`/`0032`); ~~the profile's posting
  policy enforcement by `postImportRun` (`DEC-025`) is the **next unblocked
  TECH task**~~ resolved 2026-09-21 (`DEC-082` — the run's
  `diagnostics.posting_policy` snapshot governs; `all_or_nothing` refuses
  pre-write with a `DomainError` naming the blocking rows, commits
  `12f0377`/`22b67c1`);
  ~~`file_object` is absent, so
  `import_run.file_object_id` is a plain uuid (TECH — the next task)~~
  resolved 2026-09-21 (`DEC-085` — the `file_object` table, migrations
  `0035`/`0036`; row 11 is now complete; the five deferred file FKs and the
  immutability posture stay recorded open points);
  ~~dispositions live in
  `diagnostics.dispositions` jsonb, not a table (TECH)~~ resolved 2026-09-21
  (`DEC-083` — the `import_disposition` table, migration `0033`; the frozen
  jsonb keys were removed 2026-09-21 by the data-only contract-step migration
  `0034`, closing the tracked contract step). Also a
  live-check left one dev `import_run` row in the local database (see "Local
  dev-DB cleanup" below). Record each resolution in `12_OPEN_DECISIONS.md`
  (next free id **`DEC-096`**); do not resolve silently.
- **Row-12 sales/reconciliation open points (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Row-12 sales/reconciliation open points";
  recorded, not decided — do not resolve silently):** consumption grain A1
  (`DEC-009` daily-per-location vs a single `sales_line` source);
  ~~`settlement.status` and
  `reconciliation.scope_type` have no vocabulary~~ resolved 2026-09-21
  (`DEC-078`); the `sales_line`-guard test
  fix (a pre-existing inventory test posting a `sales_line` movement with a
  fake source id was fixed — the new guard correctly rejects it); the legacy
  I19 import carries no resolvable `location_id`, so the demo theoretical
  consumption posts zero recipe-bearing lines; a local dev-DB side effect (the
  demo import run left `partially_posted` and a reconciliation reopened to
  `pending`). Row 13 is data-gated on history/grain quality (I11); row 14 is
  owner-gated on the privacy review / access matrix; rows 15–18 remain blocked
  (data / `ADR-0009`–`0011`). Record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-096`**); do not resolve silently.
- **Slice-9/10 open owner questions (2026-09-20; also tracked in
  `docs/BUILD_ROADMAP.md` §5 "Slice-9/10 open owner questions"):** output-cost
  allocation across multiple outputs/by-products (FIN); ~~yield-variance tolerance
  and exception store (`PROD-003`, FIN+TECH)~~ the exception store and its
  producers are resolved 2026-09-21 (`DEC-080` the table; `DEC-084` the
  provisional producers); the **variance-tolerance thresholds** remain open
  (FIN); work-in-progress/source-draw storage
  area (OPS+TECH); `production_plan` line/quantity model and status vocabulary
  (OPS+TECH); lot-tracked cross-location transfer policy (OPS); per-source stock
  reversal semantics (`DEC-028` — the sales-line variant is now implemented via
  `DEC-073`) not yet implemented for stock (TECH); receipts not wired to the
  ledger (TECH); ~~`lotTracked` unenforced (TECH)~~ resolved 2026-09-21
  (`DEC-078`); `DEC-009` daily theoretical
  consumption not implemented (TECH). Record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-096`**); do not resolve silently.
- **Deployment prerequisite inputs (owner; before any real `apply`):** `ADR-0004`
  acceptance; a real scoped `DIGITALOCEAN_TOKEN`; a provisioned private Spaces
  state bucket + state credentials; the sanitized-data owner; the legacy
  instance-slug/manual-scaling check; domain names (optional). The runbook
  (`docs/runbooks/deployment.md`) mandates the first real `apply` be **staging**
  with sanitized/synthetic data only — never a raw production copy (a raw
  production copy is only sanctioned via an isolated PITR restore for a data
  rollback). Nothing has been applied to DigitalOcean.
- External inputs still outstanding: supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), and the
  Frontline data-shape confirmations (item-level sales lines, per-line
  channel/applied tax, SKU, add-on representation). See
  `docs/phase0/SOURCE_DATA_REQUEST.md` and `docs/phase0/UNBLOCK_CHECKLIST.md`.
- Surfaced by the 2026-09-19 slices (also tracked in `docs/BUILD_ROADMAP.md` §5):
  - unit `m` vs the missing `length` dimension — a dimension-vocabulary mismatch
    (`schemas/domain-enums.yaml`) to resolve with the owner;
  - ~~the missing `numeric(19,6)` digit cap in
    `packages/domain/src/decimal.ts`~~ resolved 2026-09-21 (commit `bda0b6b`
    — `parseDecimal` enforces the `numeric(19, scale)` storage-precision cap,
    see "Open decisions / inputs");
  - the palette hex values need owner sign-off, and the data-viz palette
    semantics are undefined;
  - the per-IP rate limiter is per-process — a shared store (a migration) is
    needed before multi-instance deployment;
  - reset-token delivery is a no-op stub (`deliverResetToken` port) until the
    email slice;
  - ~~the deferred-FK hardening on `goods_receipt_line` (a `supplier_item_id` or
    `item_id` from another organization, a mismatched supplier, or a unit that
    does not match the item is guarded only in the application until those FKs
    are added — make them composite and validate per the runbook's
    `NOT VALID` → `VALIDATE` pattern; the `effective_to = effective_from` empty
    window is allowed by `DEC-052`)~~ resolved 2026-09-21 (`DEC-079` — the
    receipt-line coherence guard trigger enforces the supplier and item match,
    plus the deferred single-column FK on `supplier_item_id`);
  - `DEC-054` open policy points: deleting a recipe version cascades
    `recipe_allergen` (allergen history is dropped before any audit) and a zero
    `current_cost` is accepted for an item — both need a policy decision; and
    ~~cross-organization referential integrity on the recipe FKs stays
    application-guarded until the composite-FK/trigger invariants land~~
    resolved 2026-09-21 (`DEC-079` — the coherence guard triggers cover
    `recipe_allergen.allergen_id` and `recipe_line.item_id`/`sub_recipe_id`).
- Surfaced by slice 6 (`8f3ac5d`; deliberate deferrals for a decision — also
  tracked in `docs/BUILD_ROADMAP.md` §5; do not resolve silently):
  1. how the `cost_pool` amount is derived from `operating_cost` rows is currently
     an application convention, not a documented derivation rule — needs an owner
     decision (next free id `DEC-066`);
  2. `allocation_rule.denominator_source` is accepted free-text (a closed
     vocabulary would have invented values) — the owner should enumerate the
     denominators later;
  3. `scope_type` on `cost_pool`/`operating_cost` reuses the existing shared
     scope vocabulary rather than a structural per-table split — deferred;
  4. the `asset` cost register is deliberately deferred (only the four slice-6
     tables exist);
  5. imputed owner labour awaits the I8 remainder (productive-hours %, insurance,
     role→location) and the I9 accountant ruling — `DEC-055` records the
     provisional figures.
- Surfaced by slice 7 (`400c95b`): the 16 slice-7 cost-card/pricing open (owner)
  points are recorded in `docs/BUILD_ROADMAP.md` §5 ("Slice-7 cost-card / pricing
  open points"); record each owner resolution in `12_OPEN_DECISIONS.md` (next free
  id **`DEC-066`**); do not resolve silently. The golden fixtures remain unsigned
  and are the gate for "verified".
- **Surfaced by slice 8** (at HEAD `f7b1db7`, since committed with the slice-8/9 layer commits): eight
  stock-ledger open (owner/TECH) points are recorded in `docs/BUILD_ROADMAP.md` §5
  ("Slice-8 stock-ledger open points"); record each resolution in
  `12_OPEN_DECISIONS.md` (next free id **`DEC-066`**); do not resolve silently:
  goods-receipt acceptance is not yet wired to the ledger (no destination
  `storage_area_id` on a receipt; the receipt→movement integration and its
  storage-area policy are unresolved, `post-stock-movement.ts`); per-source
  reversal semantics are not enumerated (a non-receipt reversal posts movement
  type `correction`; only `receipt` → `receipt_reversal`; `DEC-028` defines the
  semantics per source type, `reverse-stock-movement.ts`); ~~`lotTracked` is not
  enforced (a lot-tracked item can post with `lotId` null,
  `post-stock-movement.ts`)~~ resolved 2026-09-21 (`DEC-078` — the null-`lotId`
  posting is rejected for a lot-tracked item; the reversal path stays exempt
  because it mirrors the original lot); the `DEC-028` "reversal blocked when reconciled
  downstream sales depend on the original" gate is deferred until the sales slice
  exposes reconciliation state (reversal always requires an explicit reason
  today); the `0017` `source_id` guard originally covered only
  `source_type='goods_receipt'` and — slice-9 persistence, migration `0020`
  (committed in `b525f30`) — now covers `stock_count`/`transfer`/`waste_event` too
  (production/sales remain documented no-ops until their slices
  extend the trigger); `DEC-009` daily theoretical sale-consumption posting is
  not implemented (no sales source exists yet; `postStockMovements` is the
  idempotent primitive the sales slice will call); `stock_balance` is written
  directly by the posting command while the runbook calls it a rebuildable
  projection (confirm the writer policy before multi-instance use); no
  application surface creates `location` rows (a pre-existing gap;
  `registerStorageArea` requires an existing location).
  Two further points from the finding fixes: the idempotency key is now a
  **per-organization** namespace (`stock_movement_org_idempotency_key_key`,
  migration `0018`), which narrows `DATA_DICTIONARY` §6's global "unique where
  not null" wording; and the DEC-010 negative-override role set
  (`NEGATIVE_OVERRIDE_ROLES = ["owner", "general_manager", "location_manager"]`,
  `packages/application/src/inventory/permissions.ts`) is fail-closed — the
  residual open point is which of those roles should grant the override
  (`DEC-066`).
- **Surfaced by slice 9** (persistence committed in `b525f30`, migration `0020`;
  Wave 2b application/API/screens in flight in three parallel agents): five
  slice-9 open (owner/TECH) points, also tracked in `docs/BUILD_ROADMAP.md` §5
  ("Slice-9 counts/transfers/waste open points", which also cross-references the
  slice-8 points above); record each resolution in `12_OPEN_DECISIONS.md` (next
  free id **`DEC-066`**); do not resolve silently:
  **no transfer line table exists** (a transfer is a header plus paired
  `stock_movement.transfer_id` movements; the per-item discrepancy is derived —
  owner/TECH to confirm the shape); the **positive count-variance `unit_cost`
  source is undecided** (the ledger's moving average is the working
  assumption — owner/FIN); **`waste_event.value_method`/`value` vs the ledger's
  moving average is undecided** (which value the waste record is judged against,
  and whether they may diverge — owner/FIN); **count `scope` shape and recount
  thresholds are undefined** (whole area vs item subset, plus the escalation
  rule, `DEC-017`/`DEC-029` — owner/FIN); ~~**no transfer-discrepancy exception
  table exists** (a discrepancy between shipped and received movements is only
  derivable from the ledger — owner/TECH)~~ resolved 2026-09-21 (`DEC-080` —
  the `data_quality_exception` table with the `transfer_discrepancy` producer).
- **Local dev-DB cleanup (not a code issue):** an ad-hoc reviewer probe left 3
  `stock_movement` rows under a throwaway org in the local dev database; the
  append-only trigger makes them undeletable (the documented destructive replay
  would clear them). Local dev-data artefact only — no repository impact.
- Surfaced by slice 5 (`841da96`, deliberate ambiguities left for a decision —
  also tracked in `docs/BUILD_ROADMAP.md` §5; do not resolve silently):
  1. allergen roll-up from sub-recipes into the parent recipe is not implemented;
  2. yield loss is applied per line and then once at recipe level, as §6 literally
     states; a batch-level alternative would change rounding;
  3. a same-instant tie between cost sources is rejected as ambiguous (no silent
     precedence, in the spirit of `DEC-050`);
  4. allergens are per recipe version, as `DATA_DICTIONARY` §3 keys them;
  5. `recipe_version` quantities carry no unit and are treated as the output item's
     base unit;
  6. `yield_rate` is derived and persisted; it is never accepted as input;
  7. `recipe_version_no_overlap` is ungated, so two draft versions of one recipe
     cannot overlap in time;
  8. `planned_output_qty` is stored but unused by the §6 formula.
- `DEC-049` is **closed** (2026-09-19): the drizzle-orm 0.45.2 /
  drizzle-kit 0.31.10 upgrade is committed (`cc86f13`) and `npm audit --omit=dev`
  reports 0; it is no longer an open security regression.
- Deployment/apply gates (updated 2026-09-20): **ADR-0004 acceptance**; the jobs
  runtime is now decided (**`DEC-062`**: pg-boss, worker/scheduler long-lived) and
  the multi-tenancy posture is decided (**`DEC-061`**: shared schema +
  `organization_id` row scoping); the
  **scheduler `SCHEDULED` provider gap** (DO provider v2.101.1 has no `SCHEDULED`
  job kind, so `scheduler` is a long-lived worker + tick loop until the
  provider/API exposes it or ADR-0004 picks a scheduler); Terraform state locking
  (**Spaces has none** — a single-runner apply is the serialization) plus the
  **out-of-band state-bucket bootstrap**; **component cost
  estimate** (`21e9c72`); staging data-sanitization owner; the **legacy
  instance-slug check** before apply; **real DO credentials** and a provisioned
  state bucket. Dockerfile/migrator packaging is **resolved** (one parameterized
  Dockerfile whose runner keeps devDependencies so the migrator carries
  `drizzle-kit`). **Required pre-apply step:** run
  `infra/bootstrap/database-grants.sql` once as `doadmin` after the cluster/users
  exist and **before the first deploy** (without it `migrator` has no DDL
  privileges and `app` cannot read) — see `docs/runbooks/deployment.md`
  ("Database privilege bootstrap") and the runbook's proxy/dry-run notes
  (`bfc5f74`).
- Persistence-slice reconciliation: vocabulary authority is
  `schemas/domain-enums.yaml`; accepted/deferred review items are the
  `stock_balance` projection convention, the `component_kind` vocabulary
  (deferred to the costing slice), the per-`source_type` validation trigger for
  `stock_movement.source_id`, and deferred-FK additions using `NOT VALID` →
  `VALIDATE CONSTRAINT`.
- The six golden fixtures must be **signed** before Phase 1 costing is treated as
  verified.
