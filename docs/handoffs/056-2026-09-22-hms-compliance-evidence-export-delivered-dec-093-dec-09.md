# 2026-09-22 — HMS compliance / evidence export delivered (DEC-093/DEC-098, no migration); the fifth and last IK-mat build slice; HMS half complete; handoff updated

`main`; HEAD before the slice was `d8bd98d` (the HMS equipment-slice handoff);
the slice lands as 5 commits, of which this context docs update is the last
(nothing pushed; nothing applied to DigitalOcean). **5 commits** in order:
`05caf1b` `docs(decisions)` — `DEC-098`; `7cb4f68` `feat(persistence)` — the
optional `from`/`to` period filter on the five HMS list queries + repository
tests; `275c3d5` `feat(application)` — the compliance evidence export bundle;
`00508a3` `feat(web)` — the `GET /api/v1/hms/compliance-export` route with
fail-closed per-source scope; this `docs(context)` update.

- **Delivered (`DEC-093`, requirement `HMS-007`, provisional `DEC-098` — the
  fifth and last build slice of the HMS/IK-mat programme, step 19e):** a
  **synchronous, storage-free JSON evidence bundle** at
  `GET /api/v1/hms/compliance-export` gathering **five** org-scoped,
  period-filtered sources — monitoring readings, incidents, corrective
  actions, checklist runs and **maintenance logs** (included because `HMS-007`
  is a _Must_ and the UI agrees; `DEC-098` item 1 resolved the `DEC-093`
  omission) — returning `{ generatedAt, organizationId, period, counts,
truncated, personalDataFields, monitoringReadings[], incidents[],
correctiveActions[], checklistRuns[], maintenanceLogs[] }` with provenance
  carried by the ids already on each record. **No file artifact, no storage
  client, no signed URL, no persisted bundle** (deferred by
  `DEC-085`/`ADR-0006`). Authorization is per-source and **fail-closed**:
  `owner`, `general_manager`, `location_manager`, `admin` only — `analyst` is
  denied (no incident/corrective-action read) and a partial bundle is
  explicitly **not** implemented; `kitchen`/`front_of_house`/`purchasing`/
  `finance` are denied. A location-scoped caller is bounded to their locations
  (`corrective_action` and `maintenance_log` scoped through their parents —
  the recorded ceiling); an unscoped caller gets the organization-wide bundle,
  and an **empty** location scope now means organization-wide at both the
  route and the query. Generating the bundle writes exactly **one**
  `audit_event` (`hms.compliance_export.generated`). Period semantics:
  optional inclusive `from`/`to`, one date column per source (`measured_at`,
  `occurred_at`, `due_date`, `run_at`, `performed_at`). **Also delivered:** the
  optional `from`/`to` period filter on the five HMS list queries at every
  layer — additive, **no migration**. **Schema:** unchanged — migrations
  through `0045`; **76 tables**. Next free decision id **`DEC-099`**.
- **Reviews and reconciliation.** `reviewer-qwen` and `reviewer-glm` each
  found **the same blocker**: the route forwarded `access.locationIds` (an
  empty array for owner/GM/admin) and the query treated
  `locationIds !== undefined` as scoped, so an owner's whole-organization
  export returned an **empty bundle** and audited an empty scope (the route
  test even asserted the buggy forwarding) — **accepted + fixed at both
  layers** and the test corrected. `reviewer-qwen` blocker 2: `truncated` was
  dishonest for a scoped caller (the cap was applied before the in-memory
  scope filter, so a scoped caller could get fewer than all in-scope rows
  while the bundle attested `truncated: false`) — **accepted + fixed**
  (`truncated` now conservative; child id sets built from the filtered
  parents, not the capped output); the **DB-side push-down remains the
  recorded upgrade path**. `reviewer-qwen` major: `DEC-098` item 5 asserted
  `07.4`'s personal-data minimization applies but nothing implements it —
  **accepted + fixed** (`DEC-098` amended to state no minimization this
  increment; the bundle declares a `personalDataFields` list). `reviewer-glm`
  major: the parent id sets were built from the capped window, silently
  dropping in-scope children — **accepted + fixed** (same fix). Minors
  **accepted + fixed**: the `due_date` calendar-day extraction from a non-UTC
  offset bound documented/tested; a scoped-window-filled `truncated: true`
  test; empty-roles and unknown-role 403 tests; the "allows admin" test now
  asserts the forwarded query; an `includes` became a `Set`. Minor
  **declined**: the audit write is best-effort outside a transaction (a read;
  a failed audit is a 500) — stays a recorded systemic open point alongside
  the driver-error→500 point. `reviewer-glm`'s step-capped pass left a
  **coverage gap** (part of the export-period test body in
  `hms.postgres.test.ts` and the persistence `*.postgres.test.ts` diffs) —
  recorded, not resolved.
- **New open points (recorded, do not decide):** the export's DB-side location
  push-down; no personal-data minimization/redaction; the bundle is not
  persisted (no retention class yet — `DEC-093`, `ADR-0006:47`); a partial
  bundle for `analyst` is not implemented; a regulator-final format is a later
  slice; evidence file bytes / signed URLs stay deferred; the period column
  choices remain provisional; the `DEC-098` provisional items; the
  `reviewer-glm` export-period coverage gap. See the first bullet under "Open
  decisions / inputs".
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **1861/1861 tests with `DATABASE_URL`** (160 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0045` is a no-op on
  re-run; **76** public base tables. **No new migration was needed for this
  slice** (so no runbook entry).
- **Next step:** the **`employee` entity + personnel documents** slice
  (`DEC-087`; requirements `WF-007` and `DOC-001`…`DOC-004`) — programme step
  20a, the first slice of the workforce-documents half and the first that is
  not HMS; then the staff document library (`DEC-088`) and the
  `task`/`approval` platform tables (`DEC-094` with the `job`/worker/outbox
  layer gated on `ADR-0004`). The programme's HMS half is now **complete**.
  Next free decision id **`DEC-099`**.

Rollback: each of the slice's 5 commits is independently `git revert`-able
(`05caf1b`, `7cb4f68`, `275c3d5`, `00508a3` and this context docs update);
**no migration** was added (migrations stay through `0045`; 76 tables), so
there is no schema-rollback concern and no ledger row to delete; nothing
pushed; nothing applied to DigitalOcean.
