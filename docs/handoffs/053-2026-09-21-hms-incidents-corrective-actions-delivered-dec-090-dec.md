# 2026-09-21 — HMS incidents + corrective actions delivered (DEC-090/DEC-095, migrations 0040–0041); the second IK-mat build slice; handoff updated

`main`; HEAD before the slice was `4f917ee` (the HMS monitoring-slice
handoff); the slice lands as up to 6 commits, of which this context docs
update is the last (the orchestrator commits them as the slice closes —
if `git log --oneline` shows their hashes, use the real ones; nothing
pushed; nothing applied to DigitalOcean). **6 commits** in order:
`docs(decisions)` — `DEC-095`; `feat(persistence)` — the incident +
corrective-action tables (migrations `0040`/`0041`) + the repository +
tests; `feat(application)` — the commands/queries + adapter + fake + tests;
`feat(web)` — the incident/corrective-action routes with role +
location-scope enforcement; `docs(runbook)` — the migration-ledger/
rehearsal entries; this `docs(context)` update.

- **Delivered (`DEC-090`, requirements `HMS-003`/`HMS-004` — the second
  build slice of the HMS/IK-mat programme, step 19b):** the HMS incident
  register (`hms_incident`: category, severity, occurred_at, reported_at,
  reported_by, nullable `owner_id` + `due_date`, title, description,
  `involves_personal_data`, status
  `open|investigating|resolved|closed`, `closed_at`) and corrective actions
  (`corrective_action`: nullable `incident_id`, nullable
  `monitoring_reading_id`, description, `owner_id`, `due_date`, status
  `open|in_progress|done|verified`, `completed_at`, `verified_by`,
  `verified_at`); org-scoped everywhere (`DEC-061`); cross-org coherence
  guard triggers (`23514`); role + location-scope enforcement on every
  route; evidence is the polymorphic `file_object` link (`DEC-085`, no
  storage integration); derived invariants (`closed_at` iff `closed`,
  `completed_at` iff `done`/`verified`, `verified_by`/`verified_at` iff
  `verified` — idempotent re-close/re-verify preserve the original
  instant/verifier); `created_by`/`updated_by` threaded from the session
  actor. **Schema:** migrations through `0041`; **72 tables** (was 70).
  Next free decision id **`DEC-096`**.
- **Migrations:** `0040_hms_incidents` (journal `idx` 40, `when`
  `1790024758839`, sha256
  `3e026ee552d93d0688e6f98da4821d773504b3148b5048eb20672f1d85e86dbf`);
  `0041_hms_incidents_org_guard` (journal `idx` 41, `when` `1790024895228`,
  sha256
  `cd6b44a2399ea48f033ab0c324933d691d94d760b9e0a4839d134737e6dfc332`); down
  companions unjournalled. The guard migration was renamed (backward tags →
  `0041_hms_incidents_org_guard`) so journal `idx` ↔ tag prefix ↔ snapshot
  name agree; the forward SQL is unchanged, so the ledger hash stays valid.
- **Rehearsal evidence (local dev DB):** `0040`/`0041` apply → 72 tables;
  guard messages and vocabulary CHECK violations all `23514`; down
  `0041` → `0040` → 70; ledger rows deleted + re-apply → 72; third run a
  no-op.
- **Reviews and reconciliation.** `reviewer-qwen` (adversarial) — no
  blockers, no majors; accepted minors: re-close overwrote `closed_at`,
  re-verify overwrote the original verifier, no `purchasing` denial test
  (all fixed/added); declined: `involves_personal_data` inert (recorded as
  an open point — a privacy-review input, not an implementation
  requirement). `reviewer-glm` (code-level) — first pass empty; re-run
  step-capped, no blocker/major; accepted minors: blank `reportedBy` and
  malformed `dueDate` unvalidated at the command boundary (fixed via the
  shared `assertOptionalCalendarDate` helper); declined: an audit fact for
  a patch that only re-sets a field to its current value, and no-op columns
  in the audit `after` payload (both consistent with the existing
  convention). A `tester` pass found four real defects, all fixed:
  `created_by`/`updated_by` never written by the adapter (threaded end to
  end); `recordCorrectiveAction` wrongly rejected a standalone action
  (`DEC-090` makes both FKs nullable); the re-close instant refresh; stale
  filename comments in the renamed down file. `reviewer-glm`'s re-run did
  not complete (step cap) on three route test files, `lib/guards.ts`/
  `lib/http.ts` internals, `incidents.postgres.test.ts` and the down
  migrations — recorded as a residual coverage gap (verified elsewhere by
  `reviewer-qwen` and the rehearsal).
- **New open points (recorded, do not decide):** the **corrective-action
  location-scope ceiling**; `involves_personal_data` inert until the
  privacy review; the `DEC-095` provisional items awaiting owner/OPS
  confirmation; the `reviewer-glm` step-capped coverage gap. See the first
  bullet under "Open decisions / inputs".
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **1574/1574 tests with `DATABASE_URL`** (149 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0041` is a no-op on
  re-run; **72** public base tables; both guard triggers present.
- **Next step:** the **HMS checklists / cleaning** slice (`DEC-091`,
  requirement `HMS-005`) — programme step 19c; then the programme build
  order (equipment/maintenance `DEC-092`, compliance export `DEC-093`,
  `employee` + personnel documents `DEC-087`, staff document library
  `DEC-088`, `task`/`approval` `DEC-094` with the `job`/worker/outbox layer
  gated on `ADR-0004`). Next free decision id **`DEC-096`**.

Rollback: each of the slice's commits is independently `git revert`-able;
migration `0040` adds two tables (additive), `0041` is trigger-only; the
rehearsed down order is `0041`→`0040`; `0040` down drops `corrective_action`
then `hms_incident` (72 → 70), `0041` down is trigger-only (72 → 72); if the
DB is rolled back, delete the two ledger rows (`created_at` `1790024758839`
/ `1790024895228`) and re-migrate (72 tables); nothing pushed; nothing
applied to DigitalOcean.
