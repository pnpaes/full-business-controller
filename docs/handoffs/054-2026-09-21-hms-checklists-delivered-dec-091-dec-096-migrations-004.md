# 2026-09-21 — HMS checklists delivered (DEC-091/DEC-096, migrations 0042–0043); the third IK-mat build slice; handoff updated

`main`; HEAD before the slice was `5c0a838` (the HMS incidents-slice
handoff); the slice lands as 6 commits, of which this context docs update is
the last (the orchestrator commits them as the slice closes — if
`git log --oneline` shows their hashes, use the real ones; nothing pushed;
nothing applied to DigitalOcean). **6 commits** in order: `bd27b18`
`docs(decisions)` — `DEC-096`; `60a4c51` `feat(persistence)` — the checklist
tables (migrations `0042`/`0043`) + the repository + tests; `d5994fd`
`feat(application)` — the commands/queries + adapter + fake + tests;
`ff6c8d0` `feat(web)` — the checklist routes with role + location-scope
enforcement; `c66ad68` `docs(runbook)` — the migration-ledger/rehearsal
entries; this `docs(context)` update.

- **Delivered (`DEC-091`, requirement `HMS-005` — the third build slice of
  the HMS/IK-mat programme, step 19c):** `checklist_template` (name,
  `category ∈ {opening, closing, cleaning, hygiene, food_safety, other}`,
  `frequency` reusing the monitoring `check_frequency` vocabulary, `items`
  jsonb, `active`, nullable `supersedes_id` self-FK satisfying `HMS-005`'s
  "version checklist templates" — a revision is a new row superseding the old
  one and every run stays pinned to the exact template row it used) and
  `checklist_run` (template FK, location FK, `run_at`, `performed_by`,
  `status ∈ {in_progress, completed}`, `results` jsonb, `notes`);
  cleaning/hygiene is a checklist **category**, not a separate table (per
  `DEC-091`); org-scoped (`DEC-061`); cross-org coherence guards on
  `checklist_run.template_id`, `checklist_run.location_id` and
  `checklist_template.supersedes_id` (`23514`); role + location-scope
  enforcement on every route (templates unscoped/organization-wide, runs
  location-scoped); `items`/`results` are JSON arrays with a provisional
  element shape, validated in the application layer plus a DB
  `jsonb_typeof = 'array'` CHECK and a shared 500-element ceiling; a `fail`
  outcome **is** the non-conformity; a supersede is atomic (active target
  required, superseded row deactivated with its own audit fact inside
  `withTransaction`). **Schema:** migrations through `0043`; **74 tables**
  (was 72). Next free decision id **`DEC-097`**.
- **Migrations:** `0042_checklists` (journal `idx` 42, `when`
  `1790027667971`, sha256
  `b5ff752d2df7d17aca0a799a9dca21bef29456c9b7a3abef6aa1b63a06ebdfa1`);
  `0043_checklists_org_guard` (journal `idx` 43, `when` `1790027669000`,
  sha256
  `955736bffd4aa92c3c3d41f85de98481c0746ae987f127891c22454ab36fdb29`); down
  companions unjournalled (`0042_checklists_down.sql` drops `checklist_run`
  then `checklist_template`, 74 → 72; `0043_checklists_org_guard_down.sql`
  trigger-only, 74 → 74). `meta/0043_snapshot.json` was created after the
  fact so the `idx` ↔ tag ↔ snapshot chain is contiguous (0040 → 0043);
  `db:generate` reports no schema changes.
- **Rehearsal evidence (local dev DB):** `0042`/`0043` apply → 74 tables; the
  guards and the six vocabulary/array/self-supersede CHECKs all `23514`; down
  `0043` → `0042` → 72; ledger rows deleted + re-apply → 74; third run a
  no-op.
- **Reviews and reconciliation.** `reviewer-qwen` (adversarial) — **no
  blockers**; three majors **accepted + fixed**: (1) superseding a
  deactivated template was unguarded (the command now requires an active
  target and deactivates the superseded row atomically; a supersede cycle is
  unreachable because `supersedes_id` is immutable after creation —
  verified); (2) a run's `results` keys were not checked against the
  template's `items` (now a `DomainError` naming the key); (3) no jsonb size
  ceiling (now a shared 500-element cap); three minors — an
  `analyst`-cannot-write test and a supersede-a-deactivated-template test
  (**added**), a `location_manager` cross-location `[id]` test (**already
  existed**). `reviewer-glm` (code-level) — **no blockers, no majors**; six
  minors — unbounded `offset` in the checklist parsers (**accepted +
  fixed**) and the same in the incident parsers (**accepted + fixed**), an
  id-`.trim()` inconsistency between the update and find commands
  (**accepted + fixed**), an audit-payload key-style inconsistency
  (**declined — already correct**, the finding was mistaken), list-filter
  values not vocabulary-validated (**declined** — matches the
  incident-parser precedent, shared debt), route tests not exercising
  `withMutationGuards` rejections (**declined** — same gap in the incident
  route tests, shared debt), a multi-location in-memory scope filter running
  after paging so a page can be short (**declined** — documented and mirrors
  the incident route, recorded as an open point).
- **New open points (recorded, do not decide):** no completeness rule for a
  `completed` run, no per-item evidence, no failed-item → `corrective_action`
  link; the provisional jsonb 500-element ceiling; list-filter values not
  vocabulary-validated (shared precedent); route tests not exercising
  `withMutationGuards` (shared debt); the short-page multi-location filter;
  no scheduling (`frequency` on the template only; due dates/reminders/
  assignment stay with the unbuilt `task`/`approval`); the `DEC-096`
  provisional items awaiting owner/OPS confirmation. See the first bullet
  under "Open decisions / inputs".
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **1699/1699 tests with `DATABASE_URL`** (154 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0043` is a no-op on
  re-run; **74** public base tables; the three checklist guard triggers
  present.
- **Next step:** the **HMS equipment / maintenance** slice (`DEC-092`,
  requirement `HMS-006`) — programme step 19d, with a `DEC-097` provisional
  clarification (no access-matrix row, no `equipment.kind`/`maintenance_kind`
  vocabularies, the `maintenance_log` location-scope ceiling, and the
  `DEC-093`/`HMS-007` + `HMS-001` conflicts); then the programme build order
  (compliance export `DEC-093`, `employee` + personnel documents `DEC-087`,
  staff document library `DEC-088`, `task`/`approval` `DEC-094` with the
  `job`/worker/outbox layer gated on `ADR-0004`). Next free decision id
  **`DEC-097`**.

Rollback: each of the slice's commits is independently `git revert`-able;
migration `0042` adds two tables (additive), `0043` is trigger-only; the
rehearsed down order is `0043`→`0042`; `0042` down drops `checklist_run` then
`checklist_template` (74 → 72), `0043` down is trigger-only (74 → 74); if the
DB is rolled back, delete the two ledger rows (`created_at` `1790027667971`
/ `1790027669000`) and re-migrate (74 tables); nothing pushed; nothing applied
to DigitalOcean.
