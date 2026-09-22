# 2026-09-22 — Row 14a shift scheduling delivered (WF-002/WF-003, DEC-102, migrations 0051–0052); the `shift`/`shift_assignment` tables with the full application + web port; handoff updated

`main`; HEAD before the slice was `e1b910b` (the staff-library +
workflow-platform handoff); the slice lands as commits `f3a990b`
`feat(persistence)`, `f4fca08` `feat(application)`, `b071ad6` `feat(web)`,
`f495047` `fix(application)` (the review fixes), `6fc3494`
`docs(decisions)` `DEC-102`, `da745f0` `docs(roadmap)`, plus this
`docs(context)` handoff (nothing pushed; nothing applied to DigitalOcean).

- **Parallel build:** three background agents built the slice in parallel —
  persistence (the Drizzle schema, migrations `0051`/`0052`, the scheduling
  repository and the vocabulary-guard change), domain+application (the
  commands/queries and the store port + adapter + fake —
  `createShift`/`updateShift`/`publishShift`/`cancelShift`/`completeShift`/
  `assignShift`/`withdrawShiftAssignment`, `findShift`/`listShifts`/
  `findShiftAssignment`/`listShiftAssignments`) and the web/HTTP layer
  (`/api/v1/workforce/shifts/**` and
  `/api/v1/workforce/shift-assignments/[id]`, the `SHIFT_READ_ROLES`/
  `SHIFT_WRITE_ROLES` access sets, shift limiters and the row mappers); the
  web agent matched the frozen application contract exactly.
- **Delivered (`WF-002`/`WF-003`, `DEC-037`/`DEC-038`, provisional
  `DEC-102`):** `shift` (location-scoped, nullable `role_code`,
  `starts_at`/`ends_at` with `ends_at > starts_at`, `break_minutes >= 0`
  default 0, `state ∈ shift_state {open, published, assigned, cancelled,
completed}` default `open`, nullable `published_at`/`actual_start`/
  `actual_end` — reserved for later time tracking, unused in the MVP — audit
  columns) and `shift_assignment` (`shift_id`/`employee_id` FKs,
  `state ∈ shift_assignment_state` with only `approved`/`withdrawn`
  reachable, nullable `assigned_by` (null = self-assigned), `assigned_at`,
  unique `(shift_id, employee_id)`, audit columns). Provisional state
  machine (`DEC-102`): `open → published` (stamping `published_at`) →
  `assigned` (on an approved manager assignment) → `completed`;
  `open|published → cancelled`; `completed`/`cancelled` terminal — a shift
  in `assigned` must be withdrawn before cancelling, and a terminal shift
  cannot be amended/published/completed/withdrawn (each a `DomainError`).
  Manager assignment only: `assignShift` creates an `approved` assignment
  and sets the shift `assigned` (enforcing the employee's `role_code`
  against a non-null shift `role_code` per WF-003 "within their role", and
  the `primary_location_id` against the shift location, fail-closed on null
  per the `DEC-099` precedent); `withdrawShiftAssignment` reverts the shift
  to `published`/`open`. Self-assignment is **deferred** pending the WF-003
  login model — no self-assign endpoint (fail-closed). Access (the `Shift
planning and rota` matrix row; `analyst`/`purchasing` excluded): read =
  owner, general_manager, location_manager, kitchen, front_of_house,
  finance, admin; write = owner, general_manager, location_manager
  (location-scoped), admin; kitchen/FOH "View own" not yet narrowed to own
  shifts (deferred with self-assignment). Multi-assignment per shift is
  allowed (the unique is per `(shift, employee)`; no headcount column).
  Migrations `0051`/`0052`; `EXPECTED_TABLES` 83 → 85 (`shift`/
  `shift_assignment` removed from `NOT_EXPECTED_TABLES`;
  `shift_adjustment`/`payroll_report` still deferred).
- **Migrations:** `0051_shift_scheduling` (journal `idx` 51, `when`
  `1790063480942`, sha256
  `157cadb1d6be16d6ccdee59ee1d2fbfdff205e212881367c6b6b00bed69d5e36`);
  `0052_shift_scheduling_org_guard` (journal `idx` 52, `when`
  `1790063500924`, sha256
  `f168c524b62e78f2c41a59eb1f044e7a0d2d81cec9a6abf847533f8c6c2bf5bd`). Down
  companions (unjournalled): `0051_shift_scheduling_down.sql` (drops
  `shift_assignment` then `shift`, 85 → 83) and
  `0052_shift_scheduling_org_guard_down.sql` (trigger-only). **Rehearsal
  evidence (local dev DB, 2026-09-22):** 85 tables / 3 shift guards / 53
  ledger rows → `0052` down (85 tables, 0 guards) → `0051` down (83 tables, 0) → delete the two ledger rows (`created_at IN (1790063480942,
1790063500924)`) → `npm run db:migrate` → 85 tables / 3 guards / 53 ledger
  rows; a further `db:migrate` a no-op.
- **Reviews and reconciliation.** Both reviewers (`reviewer-glm`,
  `reviewer-minimax`) independently found the **same blocker**:
  `withdrawShiftAssignment` reverted the shift to `published`/`open`
  unconditionally, so withdrawing an `approved` assignment on a
  `completed`/`cancelled` shift executed an illegal terminal transition
  (**accepted + fixed** — withdrawal now rejects unless the shift is
  `assigned`). Majors, both **accepted + fixed**: `assignShift` did not
  enforce `role_code` matching (WF-003 "within their role") — now rejected
  on a mismatch; `cancelShift` orphaned an `approved` assignment on a
  cancelled shift — now rejected while the shift is `assigned` (withdraw
  first). Minors, **accepted + fixed**: `updateShift` did not lock the shift
  (now `lockShift`); the double-withdraw race (withdrawal now re-reads the
  assignment under the shift lock). Recorded in `DEC-102`, not fixed: the
  dictionary's `shift.created_by` (NOT NULL FK `app_user`) satisfied by the
  nullable plain-uuid audit `created_by`; `shift_assignment`'s audit columns
  a convention; multi-assignment per shift (no headcount invariant); the
  `listShifts`/`listShiftAssignments` ordering not fully index-covered
  (harmless at MVP volume); `role_code` stays free text. Both reviewers
  verified the `0051` SQL matches the Drizzle schema exactly, the `0052`
  guards cover all three cross-org FKs (`shift.location_id`,
  `shift_assignment.shift_id`, `shift_assignment.employee_id`), the down
  path is FK-safe, the vocabulary guard change holds, the access matrix is
  faithful, and there is no dead code.
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2577/2577 tests with `DATABASE_URL`** (189 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0052` is a no-op on
  re-run; **85** public base tables. **Schema:** migrations through `0052`;
  85 tables (was 83). Next free decision id **`DEC-103`**.
- **Next step:** **row 14b — `shift_adjustment` + `payroll_report`**
  (`WF-004`/`WF-005`; epic 15), needing its own reconnaissance and a
  `DEC-103` provisional clarification (see "Resume here").

Rollback: each of `f3a990b`/`f4fca08`/`b071ad6`/`f495047`/`6fc3494`/
`da745f0` is independently `git revert`-able; migration `0051` adds two
tables (additive) and `0052` is trigger-only, with the rehearsed down order —
`0052_shift_scheduling_org_guard_down.sql` (trigger-only, 85 → 85) then
`0051_shift_scheduling_down.sql` (drops `shift_assignment` then `shift`,
85 → 83); if the DB is rolled back, delete the two ledger rows (`created_at`
`1790063480942` / `1790063500924`) and re-migrate (85 tables); nothing
pushed; nothing applied to DigitalOcean.
