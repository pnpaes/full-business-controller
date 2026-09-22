# 2026-09-22 — Staff document library delivered (DEC-088/DEC-100, migrations 0048–0049); programme step 20b, the programme's first versioned entity, the last slice of the workforce-documents half; handoff updated

`main`; HEAD before the slice was `b09bbc3` (the workforce-slice handoff,
`DEC-087`/`DEC-099`); the slice lands as **5 commits** (`2784f18`
`docs(decisions)` `DEC-100`, `ee47947` `feat(persistence)`, `2aabd1b`
`feat(application)`, `3fe7d4a` `feat(web)`, `838d11a` `docs(runbook)` — the
migration-ledger/rehearsal + roadmap entries) plus this `docs(context)`
update (nothing pushed; nothing applied to DigitalOcean).

- **Delivered (`DEC-088`, requirements `DOC-001`…`DOC-004`, provisional
  `DEC-100` — programme step 20b, the last slice of the workforce-documents
  half and the programme's first versioned entity):** the staff document
  library — `document` (`title`, `category ∈ {routine, guideline, policy,
form, other}`, `audience ∈ {all_staff, managers}`, `status ∈ {draft,
published, archived}` default `draft`, plain-uuid nullable `owner_id`
  (the `app_user` FK stays deferred repo-wide), audit columns;
  organization-scoped per `DEC-061`), `document_version` (`document_id` FK,
  `version_no` integer > 0 — named to avoid the `auditColumns()` `version`
  row-counter collision, the `recipe_version.version_no` precedent; the API
  field is `version`; a nullable real `file_object_id` FK, storage path
  deferred per `DEC-085`; nullable `notes`/`published_at`/`published_by`;
  `UNIQUE (document_id, version_no)`; the all-or-nothing
  `document_version_published_check`) and `document_acknowledgement`
  (`document_version_id` FK, `acknowledged_by`, `acknowledged_at`,
  `UNIQUE (document_version_id, acknowledged_by)`; **no audit columns** —
  the `import_disposition` fact-table precedent). Vocabularies
  `document_category`/`document_audience`/`staff_document_status` (the
  generic `document_status` backs `recipe_version.state` and was
  deliberately not reused). **Three** cross-org coherence guards (`BEFORE
INSERT OR UPDATE`, `23514`). Version model: a version is created
  unpublished and published by an explicit command stamping
  `published_at`/`published_by` together; only the highest-numbered version
  may be published; the **current published version is the greatest
  _published_ version** (a newer draft never hides it); superseded versions
  are retrievable to managers only. Status lifecycle: `draft` until the
  first version is published, then `published`; `PATCH` may set only
  `archived`; archived is terminal; publishing into an archived document is
  rejected; a repeat archive is a true no-op (no write, no audit fact).
  Access: read = **all nine roles** on published `all_staff` documents
  (matrix row `Staff document library (published)`); manage = **owner,
  general_manager, location_manager, admin**; a non-manager sees only
  published `all_staff` documents and only their current published version.
  Acknowledgements: one idempotent fact per `(version, user)`, the actor
  the session user; "optional per document" = no per-document flag or
  requirement (`DEC-088` defines none). Audit: `documents.document.
created`/`updated`, `documents.document_version.created`/`published`,
  `documents.document_acknowledgement.created` via `writeAudit`; the
  draft→published promotion lives inside the publish fact's before/after
  (one fact per action). Concurrency: version creation and publication lock
  the parent `document` row (`SELECT … FOR UPDATE`) inside the transaction.
  API: `/api/v1/documents/**` and `/api/v1/document-versions/**`.
  **Schema:** migrations through `0049`; **81 tables** (was 78). Next free
  decision id **`DEC-101`**.
- **Build:** the slice was built with parallel background agents over the
  frozen `DEC-088` contract (persistence → application → web per the
  existing package boundaries), then the adversarial reviews, the
  reconciliation fixes and the migration rehearsal; small atomic commits
  with the rollback approach in the body (Rule 2).
- **Migrations:** `0048_staff_documents` (journal `idx` 48, `when`
  `1790054700573`, sha256
  `a3583018395213ae882880c3bbb773fc74fa8a70c6b80aa36ca54a4b3fe091e5`);
  `0049_staff_documents_org_guard` (journal `idx` 49, `when`
  `1790054714766`, sha256
  `91dd4a2c63e0f3201f9c4626ee80b644358bc75d92353ecb8510d6bc323408da`); down
  companions unjournalled (`0048_staff_documents_down.sql` drops
  `document_acknowledgement` → `document_version` → `document`, 81 → 78;
  `0049_staff_documents_org_guard_down.sql` trigger-only, 81 → 81).
  **Rehearsal evidence (local dev DB, 2026-09-22):** apply → 81 tables; the
  three document guards plus the earlier workforce guards all raise
  `23514`; down `0049` → `0048` → 78; ledger rows deleted (`created_at IN
(1790054700573, 1790054714766)`) + re-apply → 81 tables / 3 document
  guards / 50 ledger rows; a further `db:migrate` a no-op.
- **Reviews and reconciliation.** Both reviewers found **no blockers**.
  `reviewer-qwen` raised two majors, both **accepted and fixed**: (a) the
  version-number computation could collide under concurrency (raw `23505` → 500) and (b) the publish "latest version" check had a TOCTOU race — both
  closed by locking the parent `document` row (`SELECT … FOR UPDATE`) in
  `createDocumentVersion`/`publishDocumentVersion`. Its minors:
  join-after-where fragility in `listDocumentAcknowledgements` (**accepted +
  fixed** by reordering); no concurrency test (**accepted** — lock usage
  asserted with spies, the `.for("update")` query exercised against real
  Postgres); `findLatestDocumentVersion` serving two semantics, and the
  latent lack of an audience check in the acknowledge command (**noted**);
  the `document_status_check` naming vs the generic `document_status`
  vocabulary (**noted**). `reviewer-glm` raised: the draft→published
  promotion writing no separate `document.updated` fact (**declined** — the
  publish fact's before/after already carries `document_status`, one fact
  per action); the same join-after-where fragility (**accepted + fixed**);
  an unused domain helper `selectCurrentPublishedVersion` and dead timer
  cleanup (**accepted**). Reconciling that last item exposed a **real
  `DOC-002` bug** both reviewers had framed as minor: the current published
  version was resolved as "latest + published", so creating a newer
  _unpublished_ version hid the still-current published version from staff
  and broke acknowledgement — **accepted + fixed** by adding
  `findCurrentPublishedVersion` (greatest published version) to the
  repository/port/adapter/fake and using it in the `[id]` route and
  `acknowledgeDocument`; the now-unused domain helper was deleted.
  `reviewer-glm`'s step cap truncated part of the web route test-assertion
  pass (a recorded coverage gap).
- **New open points (recorded, do not decide):** the unenforceable
  per-document location scope (`DOC-001` "at authorized locations"); the
  acknowledgement retention period per file class (privacy review); no
  un-archive; the `DEC-100` provisional items awaiting owner/OPS
  confirmation; the storage path deferred (`DEC-085`); `file_object` has no
  application port; the `reviewer-glm` web-route test coverage gap. See the
  first bullet under "Open decisions / inputs".
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2292/2292 tests with `DATABASE_URL`** (178 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0049` is a no-op on
  re-run; **81** public base tables; the three staff-document guard triggers
  (plus the earlier workforce guards) present.
- **Next step:** the **`task`/`approval` platform tables** (`DEC-094`) —
  programme prerequisite/workflow slice: build the spec'd `task` and
  `approval` platform tables **now** (schema + domain/application/web),
  organization-scoped, additive with a rehearsed down path, `EXPECTED_TABLES`
  updated; they host ownership and due-dates (HMS reminders from checklist
  `frequency` and monitoring `check_frequency`, corrective-action
  due-dates). The `job` table, worker/scheduler and outbox async layer stay
  **gated on `ADR-0004`** (still `Proposed`); nothing may rely on it. Needs
  its own reconnaissance; record a provisional clarification decision if the
  text leaves gaps (next free id **`DEC-101`**). Then row 14
  workforce/scheduling (buildable; subject to the WF-003 self-assignment
  login input and the privacy-review retention periods per file class).

Rollback: each of the slice's 5 commits is independently `git revert`-able;
migration `0048` adds three tables (additive), `0049` is trigger-only; the
rehearsed down order is `0049` → `0048`; `0048` down drops
`document_acknowledgement` then `document_version` then `document` (81 →
78), `0049` down is trigger-only (81 → 81); if the DB is rolled back, delete
the two ledger rows (`when` `1790054700573` / `1790054714766`) and re-migrate
(81 tables); nothing pushed; nothing applied to DigitalOcean.
