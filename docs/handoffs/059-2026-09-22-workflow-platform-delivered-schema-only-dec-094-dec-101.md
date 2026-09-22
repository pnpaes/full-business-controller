# 2026-09-22 — Workflow platform delivered schema-only (DEC-094/DEC-101, migration 0050); the `task`/`approval` tables, the programme's prerequisite/workflow slice; handoff updated

`main`; HEAD before the slice was `838d11a` (`docs(runbook)` — the 0048/0049
ledger/rehearsal + roadmap for the staff library); the slice lands as commits
`c90a45a` `feat(persistence)` — the `task`/`approval` tables (**already
committed**) — plus the pending `docs(decisions)` `DEC-101`, the roadmap
update and this `docs(context)` handoff (nothing pushed; nothing applied to
DigitalOcean).

- **Delivered (`DEC-094` — the workflow platform, schema-only):** the spec'd
  **`task`** and **`approval`** platform tables (`DATA_DICTIONARY` §9),
  schema-only with no ADR dependency; the `job` table, worker/scheduler and
  outbox layer are **not** built (gated on `ADR-0004`, still `Proposed`).
  **`task`:** free-text `type`/`priority` (NOT NULL, no vocabulary in the
  spec — the `equipment.kind`/`DEC-097` precedent), `status ∈ task_status
{open, in_progress, blocked, resolved, dismissed}` default `open`, nullable
  polymorphic `linked_entity_type`/`linked_entity_id` (all-or-nothing via
  `task_linked_entity_check`), plain-uuid nullable `owner_id` (the `app_user`
  FK deferred), nullable `due_date`/`resolution`, plain-uuid nullable
  `created_from_event_id` (no FK to `outbox_event` while the outbox is
  `ADR-0004`-gated), audit columns. **`approval`:** polymorphic
  `entity_type`/`entity_id`, nullable `entity_version` (integer, matching
  `audit_event.entity_version`), required `requested_by`/`requested_at`,
  nullable `decided_by`/`decided_at`/`decision` with the all-or-nothing
  `approval_decided_check`, nullable `comment`, audit columns; `decision ∈
approval_decision {approved, rejected}` is **nullable while pending** (the
  vocabulary has no `pending` value); `decideApproval` enforces
  **decide-once** (`WHERE decision IS NULL`; a re-decide updates nothing and
  returns `undefined`). Both organization-scoped (`DEC-061`), mutable (not
  append-only), three indexes each; the `TASK_STATUS`/`APPROVAL_DECISION`
  vocabularies exported (the yaml keys `task_status`/`approval_decision` no
  longer in `UNEXPORTED_YAML_KEYS`). **No application or web port** — the
  `DEC-085` `file_object` precedent; the `07_SECURITY_AND_NFR.md` access
  matrix has no `task`/`approval` row, so no access rule is enforced yet
  (a recorded input for the consuming slice).
- **Provisional clarifications recorded as `DEC-101`** (12 items: free-text
  type/priority; task_status with no transition guard; nullable decision;
  decide-once; plain-uuid actors; polymorphic targets + all-or-nothing
  linking; plain-uuid `created_from_event_id`; no `task.location_id`; access
  unset; mutable not append-only; no task↔approval link — the `HMS-001`
  conflict; job/outbox not built).
- **Migration:** `0050_workflow_platform` (journal `idx` 50, `when`
  `1790061475649`, sha256
  `19438c2f5ead0664a2ed74b19395d833555e999826b8c6787b6ed88aa44ebdc9`); down
  companion unjournalled (`0050_workflow_platform_down.sql` drops `approval`
  then `task`, 83 → 81). **No guard migration** — neither table has a
  cross-organization FK beyond `organization_id`. **Rehearsal evidence
  (local dev DB, 2026-09-22):** 83 tables / 51 ledger rows → down (81
  tables) → delete the ledger row (`created_at = 1790061475649`) →
  `npm run db:migrate` → 83 tables / 51 ledger rows; a further `db:migrate`
  a no-op.
- **Reviews and reconciliation.** Both reviewers found **no blockers**.
  `reviewer-minimax`'s one major: `decideApproval` did not enforce the
  decide-once its doc comment claimed (**accepted + fixed** —
  `WHERE decision IS NULL`, with a test asserting a re-decide returns
  `undefined` and does not overwrite). Its minors: `job` not listed in
  `NOT_EXPECTED_TABLES` (**accepted + fixed**); no second-decide test
  (**accepted + fixed**); `task.status` freely reversible/reopen
  (**recorded in `DEC-101`**); `UpdateTaskInput` omits
  `created_from_event_id` (**accepted — a comment now records the immutable
  provenance field**); a pre-existing journal trailing-newline nit
  (**declined, style-only**); `task.priority` free text (**recorded in
  `DEC-101`**). `reviewer-glm`'s minors: the same decide-once comment/test
  (**accepted + fixed**); the update path violating
  `task_linked_entity_check` was untested (**accepted + fixed**); the "not
  append-only" test asserted nothing about the updated row (**accepted +
  fixed**). Both reviewers verified the `0050` SQL matches the Drizzle
  schema exactly, the down path is FK-safe, the vocabulary guard change
  holds, and there is no dead code or unreachable branch.
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2306/2306 tests with `DATABASE_URL`** (179 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0050` is a no-op on
  re-run; **83** public base tables. **Schema:** migrations through `0050`;
  83 tables (was 81). Next free decision id **`DEC-102`**.
- **Next step:** **row 14 — workforce/scheduling** (`WF-001`…`WF-007`, all
  Must; epics 13–15), split into **(14a) `shift` + `shift_assignment`**
  (epic 14; the recommended next slice) and **(14b) `shift_adjustment` +
  `payroll_report`** (epic 15). Needs its own reconnaissance and a
  **`DEC-102` provisional clarification** (the state machines, the WF-003
  self-assignment login model, `role_code` matching, worked-hours
  derivation, the payroll-report shape/period, "Aggregate only" visibility,
  location scope, retention periods — the privacy-review retention periods
  must not be resolved silently).

Rollback: commit `c90a45a` is independently `git revert`-able; migration
`0050` adds two tables (additive) with the rehearsed down order —
`0050_workflow_platform_down.sql` drops `approval` then `task` (83 → 81);
if the DB is rolled back, delete the ledger row (`when` `1790061475649`)
and re-migrate (83 tables); nothing pushed; nothing applied to DigitalOcean.
