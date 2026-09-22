# 2026-09-21 — HMS monitoring points + readings delivered (DEC-089, migrations 0037–0039); the first IK-mat build slice; handoff updated

`main` HEAD `172aa9e` (the HMS monitoring `feat(web)` commit); the slice's work is
committed as 5 commits, of which this context docs update is the last
(nothing pushed; nothing applied to DigitalOcean). **5 commits** in order:
`feat(persistence)` — `monitoring_point` + `monitoring_reading` (migration
`0037`), the append-only triggers incl. a TRUNCATE guard (migration `0038`),
the org-coherence guards (migration `0039`), the vocabulary keys, the
repository + tests; `feat(domain)` — `isReadingInRange`; `feat(application)`
— the HMS store port + `registerMonitoringPoint` / `updateMonitoringPoint`
(edit + deactivate) / `recordMonitoringReading` / `findMonitoringPoint` /
list queries + adapter + fake + tests; `feat(web)` — the
`/api/v1/hms/monitoring-points` routes with role + location-scope
enforcement; `docs(runbook)` + this `docs(context)` update.

- **Delivered (`DEC-089`, requirement `HMS-002` — the first build slice of
  the HMS/IK-mat programme):** the fridge/freezer monitoring register +
  append-only reading logs (decimal-only, `numeric(19,6)`); `in_range`
  derived from the point's target range; an append-only guard rejecting
  UPDATE/DELETE/TRUNCATE (only `notes` amendable); cross-org coherence
  guards (`23514`); org-scoped everywhere (`DEC-061`); a point can be
  edited/deactivated; the API enforces the access matrix (analyst read;
  location-scoped roles) — **the first route in the repo to enforce location
  scope**. **Schema:** migrations through `0039`; **70 tables** (was 68).
  Next free decision id **`DEC-095`**.
- **Rehearsal evidence (local dev DB):** `0037`/`0038`/`0039` apply → 70
  tables; the append-only guard rejects UPDATE of `value`/`unit`/
  `measured_at`, DELETE and TRUNCATE, while a `notes`-only update succeeds;
  the org guards reject a cross-org location/storage-area/point (`23514`);
  the unique `(organization_id, code)` (`23505`) and the
  target-range/vocabulary checks (`23514`); down
  (`0039`→`0038`→`0037`) → 68 tables; ledger reset + re-apply → 70. `0038`
  was re-rehearsed after the TRUNCATE amendment (sha256 pinned).
- **Reviews and reconciliation.** `reviewer-qwen` — 2 blockers (missing
  TRUNCATE guard; `analyst` missing from the read roles) and 3 majors
  (location scope not enforced; no edit/deactivate command), all **accepted
  and applied**; plus minors: the `notes` before/after audit trail
  **recorded as an open point**, and duplicate readings at the same instant
  **documented as intentional**. `reviewer-glm` — no blocker/major; its
  trigger-pattern and unreachable-404 notes need no action; its `writeAudit`
  transaction-binding note is **declined here** (it mirrors every existing
  adapter) and **recorded as a systemic open point**.
- **New open points (recorded, do not decide):** the **systemic
  location-scope gap** (HMS is the first route to enforce it; the other
  routes do not pass `locationId` to `isAuthorizedFor`); the **audit-write
  transaction binding** (the adapters' `writeAudit` closes over the parent
  `db`, so the audit fact is not strictly inside `withTransaction` —
  systemic, a separate cross-cutting slice); the **`notes`-amendment audit
  trail** (no before/after history yet); duplicate readings at the same
  instant are **intentional**.
- **Verification (at HEAD `172aa9e`, exact):** `typecheck`, `lint`,
  `format:check`, `build` clean; **1459/1459 tests with `DATABASE_URL`**
  (143 files); `npm audit --omit=dev` = 0; `db:migrate` through `0039` is a
  no-op on re-run; 70 tables. (One test flaked once under a concurrent build
  load; three subsequent clean runs.)
- **Next step:** the **HMS incidents + corrective actions** slice (`DEC-090`,
  requirements `HMS-003`/`HMS-004`); then the programme build order
  (checklists/cleaning `DEC-091`, equipment/maintenance `DEC-092`, compliance
  export `DEC-093`, `employee` + personnel documents `DEC-087`, staff
  document library `DEC-088`, `task`/`approval` `DEC-094` with the
  `job`/worker/outbox layer gated on `ADR-0004`). Next free decision id
  **`DEC-095`**.

Rollback: each of the slice's commits is independently `git revert`-able;
migration `0037` adds two tables (additive), `0038`/`0039` are trigger-only;
the rehearsed down order is `0039`→`0038`→`0037`; if the DB is rolled back,
delete the three ledger rows (`created_at` `1789995070090` /
`1789995080123` / `1789996231921`) and re-migrate (70 tables); nothing
pushed; nothing applied to DigitalOcean.
