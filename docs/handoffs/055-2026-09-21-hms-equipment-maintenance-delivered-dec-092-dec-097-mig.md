# 2026-09-21 — HMS equipment / maintenance delivered (DEC-092/DEC-097, migrations 0044–0045); the fourth IK-mat build slice; handoff updated

`main`; HEAD before the slice was `346847b` (the HMS checklists-slice
handoff); the slice lands as 6 commits, of which this context docs update is
the last (the orchestrator commits them as the slice closes — if
`git log --oneline` shows their hashes, use the real ones; nothing pushed;
nothing applied to DigitalOcean). **6 commits** in order: `35561da`
`docs(decisions)` — `DEC-097`; `d5b7001` `feat(persistence)` — the
equipment/maintenance tables (migrations `0044`/`0045`) + the repository +
tests; `da53faa` `feat(application)` — the commands/queries + adapter + fake

- tests; `37c3a74` `feat(web)` — the equipment/maintenance routes with role +
  location-scope enforcement; `23e175f` `docs(runbook)` — the
  migration-ledger/rehearsal entries; this `docs(context)` update.

* **Delivered (`DEC-092`, requirement `HMS-006` — the fourth build slice of
  the HMS/IK-mat programme, step 19d):** `equipment` (location FK, `code`,
  `name`, `kind` — free text, no vocabulary, per `DEC-092`; `serial_no`,
  `installed_at` and `warranty_until` as calendar dates, `active`;
  `UNIQUE (organization_id, code)`) and `maintenance_log` (equipment FK
  **NOT NULL**, `kind ∈ {service, repair, inspection}` from the new
  `maintenance_kind` vocabulary, `performed_at` timestamptz, `performed_by`,
  `notes`, and a **real nullable FK** `file_object_id → file_object.id` —
  deliberately unlike the incident slice's polymorphic evidence link).
  `maintenance_log` is a **fact log: create + read only** (no update/delete
  command, and no DB immutability trigger — not authorised by `DEC-092`).
  Org-scoped (`DEC-061`); cross-org coherence guards on
  `equipment.location_id`, `maintenance_log.equipment_id` and
  `maintenance_log.file_object_id` (skipping NULL) raising `23514`; role +
  location-scope enforcement on every route (equipment is location-scoped;
  `maintenance_log` has **no `location_id`**, so a scoped caller must supply
  `equipmentId` on the flat list and the equipment is resolved org-scoped for
  every caller — the same ceiling recorded for `corrective_action`).
  `equipment` is a **new HMS entity, not the separately-deferred finance
  `asset` register**. **Schema:** migrations through `0045`; **76 tables**
  (was 74). Next free decision id **`DEC-098`**.
* **Migrations:** `0044_equipment` (journal `idx` 44, `when`
  `1790030048087`); `0045_equipment_org_guard` (journal `idx` 45, `when`
  `1790030073708`); down companions unjournalled (`0044_equipment_down.sql`
  drops `maintenance_log` then `equipment`, 76 → 74;
  `0045_equipment_org_guard_down.sql` trigger-only, 76 → 76).
* **Rehearsal evidence (local dev DB):** `0044`/`0045` apply → 76 tables;
  duplicate `code` `23505`, the `maintenance_kind` and non-empty CHECKs
  `23514`, the three guards `23514`, a NULL `file_object_id` accepted; down
  `0045` → `0044` → 74; ledger rows deleted + re-apply → 76; third run a
  no-op (46 ledger rows). Snapshot chain `0042` → `0045` verified contiguous.
* **Reviews and reconciliation.** `reviewer-qwen` — **no blockers, no
  majors**; two minors **declined and recorded as open points**: (1) a bad FK
  id → **500** instead of 400/404 — **systemic**, proposed single root-cause
  fix in `apps/web/lib/http.ts`'s `mapErrors`, deliberately not patched
  per-route; (2) `maintenance_log`'s unused `updated_at`/`updated_by`/
  `version` — **declined as intentional** (uniform `auditColumns()`
  convention; `checklist_run` has the same shape). `reviewer-glm` —
  **no blockers**; one major **accepted + fixed** (the flat and nested
  maintenance-log lists disagreed on an unknown/cross-org `equipmentId` —
  the equipment is now resolved org-scoped for every caller: 404
  missing/cross-org, 403 out of location scope); three accepted fixes
  (command-level length ceilings in a new `equipment-limits.ts` imported by
  the web parser; `recordMaintenanceLog` trims `kind` before the vocabulary
  check; the org-scoped resolution); three declined minors (ISO instants
  requiring seconds — consistent with `assertIsoInstant`; a dead
  `NotFoundError` branch and missing command-level `limit`/`offset` checks —
  both match the existing routes' shape). Its step-capped pass left a
  **coverage gap** (five files/sections — recorded, not resolved).
* **New open points (recorded, do not decide):** the systemic driver-error
  mapping; the unused audit columns on fact logs; ISO instants requiring
  seconds; command-level `limit`/`offset` range checks; the `reviewer-glm`
  coverage gap; `maintenance_log` has no `location_id`; `equipment.kind` is
  free text pending an owner/OPS vocabulary; `maintenance_log` has no DB
  immutability trigger; the `DEC-097` provisional items; and the two
  requirement-vs-decision conflicts (`HMS-007`/`DEC-093` maintenance coverage;
  `HMS-001`'s `task`/`approval` link). See the first bullet under "Open
  decisions / inputs".
* **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **1816/1816 tests with `DATABASE_URL`** (159 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0045` is a no-op on
  re-run; **76** public base tables; the three equipment guard triggers
  present.
* **Next step:** the **compliance / evidence export** slice (`DEC-093`,
  requirement `HMS-007`) — programme step 19e, the last HMS slice (it must
  cover readings, incidents, corrective actions, checklist runs **and
  maintenance**); then the programme build order (`employee` + personnel
  documents `DEC-087`, staff document library `DEC-088`, `task`/`approval`
  `DEC-094` with the `job`/worker/outbox layer gated on `ADR-0004`). Next
  free decision id **`DEC-098`**.

Rollback: each of the slice's commits is independently `git revert`-able;
migration `0044` adds two tables (additive), `0045` is trigger-only; the
rehearsed down order is `0045`→`0044`; `0044` down drops `maintenance_log`
then `equipment` (76 → 74), `0045` down is trigger-only (76 → 76); if the DB
is rolled back, delete the two ledger rows (`created_at` `1790030048087`
/ `1790030073708`) and re-migrate (76 tables); nothing pushed; nothing
applied to DigitalOcean.
