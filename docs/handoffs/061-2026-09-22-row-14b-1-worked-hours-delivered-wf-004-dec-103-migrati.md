# 2026-09-22 — Row 14b-1 worked hours delivered (WF-004, DEC-103, migrations 0053–0054); the `shift_adjustment` table + the worked-hours derivation/report with the full application + web port; handoff updated

`main`; HEAD before the slice was `50651f8` (the row-14a handoff); the slice
lands as commits `a67fe49` `feat(persistence)`, `826800e` `feat(domain)`,
`74d9210` `feat(application)`, `9b8e8fc` `feat(web)`, `dce1a15`
`fix(workforce)` (the review fixes), `5c1dd73` `docs(decisions)` `DEC-103`,
`f49490a` `docs(roadmap)`, plus this `docs(context)` handoff (nothing
pushed; nothing applied to DigitalOcean).

- **Parallel build:** the slice was built with parallel background agents
  over the frozen contract (persistence → domain/application → web per the
  existing package boundaries), then the adversarial reviews, the
  reconciliation fixes and the migration rehearsal; small atomic commits
  with the rollback approach in the body (Rule 2).
- **Delivered (`WF-004`, `DEC-037`/`DEC-038`, provisional `DEC-103`):**
  `shift_adjustment` (`shift_assignment_id` FK, `adjusted_hours
numeric(9,2)` >= 0 capped at 9999999.99, required `reason`, nullable
  `approved_by`/`approved_at` with the all-or-nothing
  `shift_adjustment_approved_check`, audit columns) with the `0054`
  cross-org guard on `shift_assignment_id` (`23514`). Worked-hours
  derivation (domain, decimal-only never floats): an assignment contributes
  hours when `shift_assignment.state = 'approved'` and `shift.state ∈
{assigned, completed}` and the shift `starts_at` is in the report's
  half-open period `[from, to)`; per assignment the hours are the **latest
  `shift_adjustment.adjusted_hours`** when one exists, else
  `(ends_at − starts_at) − break_minutes`, floored at zero, at scale 2
  HALF_UP; `sumWorkedHoursByEmployee` sums per employee ordered by name
  then id. Application: `createShiftAdjustment` (validated decimal string,
  approved by the acting manager at write time — single-stage, rejected on
  a withdrawn assignment), `find`/`listShiftAdjustment(s)`, and
  `computeWorkedHours` (the derived per-employee report for a period,
  `{ from, to, rows, totalHours }`). Access: `WORKED_HOURS_READ_ROLES`/
  `WRITE_ROLES` = owner, general_manager, location_manager, finance, admin
  (the payroll-input rows; **`analyst` excluded** — the matrix's
  "Aggregate" is unimplemented; the adjustment register follows the
  worked-hours roles, **not** the rota read roles — a review fix so the
  payroll hours do not leak to kitchen/FOH). API: `GET/POST
/api/v1/workforce/shift-assignments/[id]/adjustments` and
  `GET /api/v1/workforce/worked-hours`. The report is **not persisted**
  (computed on demand; no artifact, no retention class); a scoped caller is
  bounded to their location, and a multi-location caller must name
  `locationId` (fail-closed). Migrations `0053`/`0054`; `EXPECTED_TABLES`
  85 → 86 (`shift_adjustment` removed from `NOT_EXPECTED_TABLES`; only
  `payroll_report` still deferred).
- **Migrations:** `0053_shift_adjustment` (journal `idx` 53, `when`
  `1790067016722`, sha256
  `cc589075fe649e35d2eb1fd57129b2b339dacce22dc7ac2e8daee7a7afe0c5e3`);
  `0054_shift_adjustment_org_guard` (journal `idx` 54, `when`
  `1790067030453`, sha256
  `202aeaad413ae3dbf6be2e24dd28d56363dd0203b62163492e54b0d86a3f0585`). Down
  companions (unjournalled): `0053_shift_adjustment_down.sql` (drops
  `shift_adjustment`; 86 → 85), `0054_shift_adjustment_org_guard_down.sql`
  (trigger-only). **Rehearsal evidence (local dev DB, 2026-09-22):** 86
  tables / 1 shift_adjustment guard / 55 ledger rows → `0054` down (86, 0
  guards) → `0053` down (85, 0) → delete the two ledger rows (`created_at
IN (1790067016722, 1790067030453)`) → `npm run db:migrate` → 86 tables /
  1 guard / 55 ledger rows; a further `db:migrate` a no-op.
- **Reviews and reconciliation.** Both reviewers found **no blocker**.
  Majors, both **accepted + fixed**: the adjustment GET/POST was gated on
  the rota read roles, leaking the payroll-input hours to kitchen/FOH —
  now `WORKED_HOURS_READ_ROLES`/`WRITE_ROLES`; `adjusted_hours` above the
  `numeric(9,2)` range raised an unhandled `22003` (500) — now capped in
  the command and the parser (400/`DomainError`). Minors, **accepted +
  fixed**: the report's latest-adjustment tie-break disagreed with
  `listShiftAdjustments` (now both `created_at desc, id asc`); the report
  joins now org-scope `shift`/`employee` explicitly (defence in depth).
  Recorded in `DEC-103`, not fixed: the single-stage approval model (the
  actor is the approver; the nullable pair supports a future two-stage
  flow but none is implemented); `analyst` excluded from the worked-hours
  report (the matrix's "Aggregate" is unimplemented — an open point); the
  report is not persisted; the retention period. Both reviewers verified
  the `0053` SQL matches the schema, the `0054` guard is correct, the
  decimal derivation is float-free with HALF_UP at 2dp, the `[from, to)`
  window and latest-adjustment subquery are correct, and the down path is
  FK-safe.
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2703/2703 tests with `DATABASE_URL`** (192 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0054` is a no-op on
  re-run; **86** public base tables. **Schema:** migrations through
  `0054`; 86 tables (was 85). Next free decision id **`DEC-104`**.
- **Next step:** **row 14b-2 — `payroll_report`** (`WF-005`; epic 15),
  needing its own reconnaissance and a `DEC-104` provisional clarification
  (see "Resume here").

Rollback: each of `a67fe49`/`826800e`/`74d9210`/`9b8e8fc`/`dce1a15`/
`5c1dd73`/`f49490a` is independently `git revert`-able; migration `0053`
adds one table (additive) and `0054` is trigger-only, with the rehearsed
down order — `0054_shift_adjustment_org_guard_down.sql` (trigger-only, 86 → 86) then `0053_shift_adjustment_down.sql` (drops `shift_adjustment`, 86 →
85); if the DB is rolled back, delete the two ledger rows (`created_at`
`1790067016722` / `1790067030453`) and re-migrate (86 tables); nothing
pushed; nothing applied to DigitalOcean.
