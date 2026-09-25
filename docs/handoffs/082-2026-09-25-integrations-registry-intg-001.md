# 2026-09-25 — The Integrations registry delivered (INTG-001, ADR-0011 Accepted, DEC-137)

`main`; nothing pushed; nothing applied to DigitalOcean.
This slice closes the last "No backend" Administration bullet: the
Integrations registry (**INTG-001**) is delivered as a **read-only,
per-source governed `integration_source` register**, per handoff
[`081`](081-2026-09-25-design-system-and-storage-port-wave.md) (which covers
the design-system completion and the `file_object` storage port — do not
restate them).

**What was decided and what was built.** `ADR-0011`
(`docs/adr/0011-external-publishing.md`) was accepted on 2026-09-25
(owner + tech lead), and **`DEC-137`** was recorded as **accepted, not
provisional**: the registry is a synchronous configuration surface and is
therefore **not blocked on `ADR-0004`** — only publishing execution is
gated. The slice built migration `0069` plus the persistence, application
and web layers: the `integration_source` table, the register/update/list
commands, `GET`/`POST`/`PATCH /api/v1/administration/integrations` and an
Administration register screen with labels. Access is **owner + admin**
(`ADMIN_INTEGRATIONS_ROLES`), fail-closed; mutations carry same-origin plus
the shared `DEC-135` throttle. **No secret is stored** —
`credentials_owner` is a name only — and there is **no external call and
no posted fact touched**.

- **Commits (chronological; each independently revertible).**
  1. `9508f1e` `feat(integrations)`: migration
     `0069_integration_source.sql` (expand-only), the persistence layer,
     the application use cases and the seed.
  2. `02c3081` `docs`: ADR-0011 moved to Accepted, `DEC-137` recorded,
     the roadmap row 16 update.
  3. `ef23028` `feat(integrations)`: the GET/POST/PATCH
     `/api/v1/administration/integrations` routes, the Administration
     register screen and its labels.
  4. `23f803f` `fix`: dedupe `allowed_operations`, plus the down-file
     rehearsal note.
  5. `64415db` `docs`: the runbook `0069` row and the ADR-0011 status
     references.
  This handoff/`CONTEXT.md` update is a further `docs(...)` commit on top.
- **Migration `0069`.** Expand-only, adding the `integration_source` table;
  the down companion is `0069_integration_source_down.sql`; the journal
  stamp is `1790367974095`; sha256
  `c599f955ee34e321705cf603414e1a1203f0c271afb83f574967dc99264a0caf`.
  Public tables go **94 → 95**; `publish_run` remains deliberately deferred
  in `NOT_EXPECTED_TABLES`.
- **The seed and the DEC-015 invariant.** Six sources are seeded
  **read-only** with `terms_status='pending'` and no write operation:
  Frontline POS (`pos`), Wolt (`wolt`), Foodora (`other`), Medusa
  (`medusa`) and Sanity (`sanity`, credentials owner TECH); Fiken (`fiken`,
  credentials owner FIN — its `write_accounting` stays pending until the
  accountant's posting structure is confirmed). The DB check
  `integration_source_write_requires_approved_terms_check` forbids a write
  operation unless the source's terms are approved (`DEC-015`).
- **Verification at the slice.** `typecheck`, `lint`, `format:check` clean;
  `next build` exit 0; **4807/4807 tests (342 files)** with `DATABASE_URL`;
  `db:migrate` applied `0069`; the `0069` **down path was rehearsed on a
  scratch DB** (table present → absent → dropped) — never on the dev DB.
- **Review reconciliation.** `reviewer-qwen`
  (model `opencode-go/qwen3.7-plus`) — no blockers; one minor **accepted
  and fixed in `23f803f`**: `allowed_operations` accepted duplicates
  (`["read","read"]`); clean on the `DEC-015` invariant, org-scoping/IDOR,
  access, input validation, migration and screen honesty.
  `reviewer-minimax` (model `opencode-go/minimax-m3`) — no blockers; four
  minors: (1) the runbook `0069` row was missing — **accepted**, fixed in
  `64415db`; (2) the down file lacked rehearsal evidence — **accepted**,
  fixed in `23f803f`; (3) the Phase-0 draft's `created_by`/`updated_by`
  `app_user` FK is replaced by the repo-wide plain-uuid `auditColumns()`
  convention — **accepted as a recorded note** in the `DEC-137` row; (4)
  `direction` and `allowed_operations` are not DB-coupled (a row may say
  `write`/`read_write` with no write operation) — **accepted as a recorded
  note** in the `DEC-137` row. **No findings were declined.**
- **What is deferred.** **INTG-002** (idempotent publish jobs with
  confirmation read-back, audit, rollback and failure alerts) is gated on
  `ADR-0004` (still Proposed) and is **not built** — the Administration
  screen states this honestly. The per-source write terms (**I15**/I18)
  remain open: a write operation can be enabled only when that source's
  terms are approved, per the `DEC-015` gate.
- **Rollback (Rule 2).** Run
  `packages/persistence/drizzle/0069_integration_source_down.sql`
  (destructive only to registry configuration), then `git revert` each
  commit. `23f803f`, `64415db` and the docs commits are trivially
  revertible; **no posted money or stock fact is affected**. See the
  reversibility-log entry appended with this handoff.
