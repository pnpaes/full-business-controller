# 2026-09-22 — `employee` + personnel documents delivered (DEC-087/DEC-099, migrations 0046–0047); programme step 20a, the first slice of the workforce-documents half; handoff updated

`main`; HEAD before the slice was `282046d` (the HMS compliance/evidence-export
handoff); the slice lands as **5 commits** (`246c735` `docs(decisions)`
`DEC-099`, `59ad19e` `feat(persistence)`, `4faa6aa` `feat(application)`,
`603054f` `feat(web)`, `5b932a8` `docs(runbook)`) plus this `docs(context)`
update (nothing pushed; nothing applied to DigitalOcean).

- **Delivered (`DEC-087`, requirement `WF-007`, provisional `DEC-099` — the
  first slice of the workforce-documents half, step 20a):** the **`employee`**
  parent (`user_id` — a real nullable FK to the organization-scoped
  `app_user`; `name`; `role_code` free text; `employment_type` CHECK-backed;
  `base_hourly_rate numeric(19,4)`; `cost_center_id` plain uuid (the
  cost-centre FK stays deferred); `primary_location_id`; `active_from`/
  `active_to`; `retired_at`; **retired, never deleted**) and
  **`employee_document`** (`employee_id` FK, `kind ∈ {contract, certificate,
id_document, other}` from the new `employee_document_kind` vocabulary,
  `title`, a **nullable real FK** `file_object_id`, `issued_at`/`expires_at`
  as nullable calendar dates). Org-scoped (`DEC-061`); **four** cross-org
  coherence guards (`employee.primary_location_id`, `employee.user_id`,
  `employee_document.employee_id`, the nullable
  `employee_document.file_object_id`) raising `23514`. **No document version
  model** (`DEC-087` defines none — the "versioning" wording belongs to
  `DEC-088`'s staff library, deliberately **not** built). Access: employees
  follow the matrix row `Employee records` (owner, general_manager,
  location_manager location-scoped, **finance**, admin); personnel documents
  follow `Employee personnel documents` (**owner, general_manager, admin only —
  finance explicitly excluded**, a deliberate asymmetry). A location-scoped
  caller cannot see or mutate an employee whose `primary_location_id` is NULL
  (fail-closed). `baseHourlyRate` is a decimal **string** end to end. The API
  is `/api/v1/workforce/**`. **Schema:** migrations through `0047`; **78
  tables** (was 76). Next free decision id **`DEC-100`**.
- **Migrations:** `0046_workforce` (journal `idx` 46, `when` `1790035770192`,
  sha256 `c6ac6a67a527bfeeda6392733b76ad14112d56d3549cbbc1545c5485879dc158`);
  `0047_workforce_org_guard` (journal `idx` 47, `when` `1790035771192`, sha256
  `51cdb6d141c38c36d50393e22ef8183160c531c58e2e9245978108521f558940`); down
  companions unjournalled (`0046_workforce_down.sql` drops `employee_document`
  then `employee`, 78 → 76; `0047_workforce_org_guard_down.sql` trigger-only,
  78 → 78). **Rehearsal evidence (local dev DB):** apply → 78 tables; the four
  CHECKs and four guards all `23514`; NULL-skipping accepted; down `0047` →
  `0046` → 76; ledger rows deleted + re-apply → 78; further run a no-op.
  **Note:** `0047` was amended **before commit** to add the
  `employee_user_org_guard` after a review established that `app_user` is
  organization-scoped; the migration was uncommitted, so its ledger hash was
  updated and the rehearsal re-run. Also note `employee` moved from
  `schema.test.ts`'s `NOT_EXPECTED_TABLES` into `EXPECTED_TABLES`.
- **Reviews and reconciliation.** Both reviewers found **no blockers and no
  majors**. `reviewer-qwen`'s three minors: route comments cited
  `DOC-001`…`DOC-004` (the `DEC-088` staff-library requirements) instead of
  `WF-007` (**accepted + fixed**); the NULL-`primary_location_id` fail-closed
  rule was an unrecorded design decision (**accepted — recorded in `DEC-099`
  item 6**); `employee.user_id` had no org guard (**accepted + fixed** once
  `app_user` was confirmed organization-scoped, which also amended `0047`
  pre-commit). `reviewer-glm`'s seven minors: the document list filter did not
  vocabulary-check `kind` (**accepted + fixed**); the fake store defaulted
  `limit` to unbounded (**accepted + fixed**); a repeat retire wrote a spurious
  audit fact and bumped `updated_at` (**accepted + fixed** — now a true
  no-op); a dead `NotFoundError` branch in the employees POST route
  (**accepted + fixed**); contradictory `active`/`retired` list filters were
  silently accepted (**accepted + fixed** — now a `DomainError`); the fake
  sorts by JS codepoint while Postgres uses collation for non-ASCII names
  (**declined, noted**); a blank-string PATCH date clears the field
  (**declined** — the documented convention). `reviewer-glm` reported no
  unreached areas this time.
- **New open points (recorded, do not decide):** `WF-007`'s audited
  upload/replace **and retention** is not implementable while `DEC-087` defers
  the storage path; retention periods per file class remain a privacy-review
  input; no version model for personnel documents; `role_code` has no CHECK;
  `employee.cost_center_id` is a plain uuid; no un-retire/delete path; the
  provisional NULL-`primary_location_id` fail-closed rule; location scope
  enforced in the web layer only; the fake's codepoint ordering vs Postgres
  collation; the standing systemic `writeAudit` transaction binding and
  driver-error→500 mapping. See the first bullet under "Open decisions /
  inputs".
- **Verification (exact):** `typecheck`, `lint`, `format:check`, `build`
  clean; **2057/2057 tests with `DATABASE_URL`** (168 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0047` is a no-op on
  re-run; **78** public base tables; the four workforce guard triggers present.
- **Next step:** the **staff document library** slice (`DEC-088`; requirements
  `DOC-001`…`DOC-004`) — programme step 20b, the last slice of the
  workforce-documents half (the **first versioned** entity in the programme;
  all-staff read of published `all_staff` documents, managers publish,
  superseded versions retrievable to managers only, optional audited
  acknowledgements); then the `task`/`approval` platform tables (`DEC-094`,
  with the `job`/worker/outbox layer gated on `ADR-0004`). Next free decision
  id **`DEC-100`**.

Rollback: each of the slice's 5 commits is independently
`git revert`-able; migration `0046` adds two tables (additive), `0047` is
trigger-only; the rehearsed down order is `0047` → `0046`; `0046` down drops
`employee_document` then `employee` (78 → 76), `0047` down is trigger-only
(78 → 78); if the DB is rolled back, delete the two ledger rows (`when`
`1790035770192` / `1790035771192`) and re-migrate (78 tables); nothing pushed;
nothing applied to DigitalOcean.
