# 2026-09-22 — Row 14b-2 payroll-input report delivered (WF-005, DEC-104, migrations 0055–0056); the `payroll_report` table + snapshot + full application + web port — row 14 complete (14a + 14b-1 + 14b-2); handoff updated

`main`; HEAD before the slice was `32231d6` (the row-14b-1 handoff); the
slice lands as commits `f17fb29` `feat(persistence)`, `87e92f5`
`feat(domain)`, `321d6e5` `feat(application)`, `2285e2e` `feat(web)`,
`40595a9` `fix(scheduling)` (the review fixes), `2690959`
`docs(decisions)` `DEC-104`, the roadmap update, plus this
`docs(context)` handoff (nothing pushed; nothing applied to
DigitalOcean).

- **Parallel build:** the slice was built with parallel background agents
  over the frozen contract (persistence → domain/application → web per
  the existing package boundaries), then the adversarial reviews, the
  reconciliation fixes and the migration rehearsal; small atomic commits
  with the rollback approach in the body (Rule 2).
- **Delivered (`WF-005`, `DEC-037`, provisional `DEC-104`):**
  `payroll_report` — `period_start`/`period_end` (date, `period_end >
period_start`), `generated_at`, nullable plain-uuid `generated_by`,
  `status ∈ payroll_report_status {draft, generated, exported,
superseded}` default `draft` (every producer writes `generated`), a
  `snapshot` jsonb, a nullable **real** `file_object` `export_file_id`
  FK, audit columns; the **partial unique**
  `payroll_report_org_period_key` on `(organization_id, period_start)
WHERE status <> 'superseded'` (one _live_ report per period;
  superseded history retained); the `0056` guard covers the nullable
  `export_file_id`. Snapshot (`packages/domain/src/payroll.ts`):
  `{ schemaVersion: 1, currency: "NOK", periodStart, periodEnd, lines:
[{ employeeId, employeeName, roleCode, hours, hourlyRate, expectedPay
}], totalHours, totalExpectedPay }`, decimal strings only,
  `expectedPay = hours × hourlyRate` at money scale 4 HALF_UP, lines
  ordered by name then id, totals at their scales. Application:
  `generatePayrollReport` (validated period, the worked-hours derivation
  reused with the employee's `base_hourly_rate`, the prior **live**
  same-period report superseded under a `SELECT … FOR UPDATE` lock
  before insert), `findPayrollReport`, `listPayrollReports`,
  `markPayrollReportExported` (only from `generated`). Access:
  `PAYROLL_REPORT_READ/WRITE_ROLES` = owner, general_manager, finance,
  admin (the `Payroll-input reports` matrix row); `location_manager`
  deliberately excluded (matrix None — a recorded `DEC-104` asymmetry);
  `analyst` "Aggregate" unimplemented (fail-closed). Period
  `[periodStart T00:00:00Z, dayAfter(periodEnd) T00:00:00Z)` — the whole
  `period_end` day, UTC calendar arithmetic. Generation is **on demand**
  (the "~3 days before month-end" trigger is `ADR-0004`-gated, not
  built). API: `GET/POST /api/v1/workforce/payroll-reports`,
  `GET /payroll-reports/[id]`, `POST /payroll-reports/[id]/export`.
  Migrations `0055`/`0056`; `EXPECTED_TABLES` 86 → 87 (`payroll_report`
  removed from `NOT_EXPECTED_TABLES`).
- **Migrations:** `0055_payroll_report` (journal `idx` 55, `when`
  `1790069367957`, sha256
  `18b9789e64c5fb462828402036ec0a9d87c9090d43034a71fd1de9932c7ae87d`);
  `0056_payroll_report_org_guard` (journal `idx` 56, `when`
  `1790069368959`, sha256
  `4aa9675bcd8156f4882aade667c9dc3ecab3e4f69e5ac2ded508c0dccff63631`).
  Down companions (unjournalled): `0055_payroll_report_down.sql` (drops
  `payroll_report`; 87 → 86), `0056_payroll_report_org_guard_down.sql`
  (trigger-only). **Rehearsal evidence (local dev DB, 2026-09-22):** 87
  tables / 1 payroll guard / 57 ledger rows → `0056` down (87, 0 guards)
  → `0055` down (86) → delete the two ledger rows (`created_at IN
(1790069367957, 1790069368959)`) → `npm run db:migrate` → 87 tables /
  1 guard / 57 ledger rows; a further `db:migrate` a no-op.
- **Reviews and reconciliation.** Both reviewers found **no blocker**.
  Two majors, both **accepted + fixed** (both reviewers independently):
  `findPayrollReportForPeriod` could return a **superseded** row (no
  status predicate, no order), breaking the third regeneration of a
  period with a raw 23505 → 500 — now filters `status <> 'superseded'`
  (and the fake mirrors it); the **supersede-then-insert was not
  serialised**, so concurrent generations could collide — now
  `lockPayrollReportForPeriod` (`SELECT … FOR UPDATE`). Minors,
  **accepted + fixed**: the web parser's duplicate status list now
  imports the exported `PAYROLL_REPORT_STATUSES`; a `ponytail:` note
  records the current-rate-for-the-whole-period simplification; added
  tests for the triple regeneration, the live-row lookup, and a `draft`
  export refusal. Recorded in `DEC-104`, not fixed: the "remaining
  planned shifts run as scheduled" assumption is **not** implemented
  (only `{assigned, completed}` shifts count, so a pre-month-end report
  under-counts — the biggest open item); whether the base or loaded rate
  is intended; `currency` hard-coded `NOK`; the `draft` status is
  unreachable through the API; the `DEC-027` period-lock interaction;
  retention; the application-layer-only audit. Both reviewers verified
  the `0055` SQL matches the schema, the partial unique is the right
  model, the decimal snapshot math is float-free with HALF_UP, and the
  down path is FK-safe.
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2830/2830 tests with `DATABASE_URL`** (196 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0056` is a no-op on
  re-run; **87** public base tables. **Schema:** migrations through
  `0056`; 87 tables (was 86). Next free decision id **`DEC-105`**.
- **Next step:** two buildable candidates, in order — the **receipt→ledger
  wiring** (gated on the OPS receipt destination `storage_area_id`
  policy, a recorded owner input) and **row 13 — close + dashboards +
  menu engineering** (`ADR-0007` accepted; data-gated on I11, synthetic
  fixtures until real data) (see "Resume here").

Rollback: each of `f17fb29`/`87e92f5`/`321d6e5`/`2285e2e`/`40595a9`/
`2690959` is independently `git revert`-able; migration `0055` adds one
table (additive) and `0056` is trigger-only, with the rehearsed down
order — `0056_payroll_report_org_guard_down.sql` (trigger-only, 87 → 87)
then `0055_payroll_report_down.sql` (drops `payroll_report`, 87 → 86);
if the DB is rolled back, delete the two ledger rows (`created_at`
`1790069367957` / `1790069368959`) and re-migrate (87 tables); nothing
pushed; nothing applied to DigitalOcean.
