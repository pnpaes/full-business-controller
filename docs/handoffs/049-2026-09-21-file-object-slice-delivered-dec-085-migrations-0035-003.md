# 2026-09-21 — file_object slice delivered (DEC-085, migrations 0035/0036); row 11 complete; handoff updated

`main` HEAD `ebd6ed3`; the slice is committed as five commits — `b3a3e02`,
`1fd8e4e`, `818b63c`, `ebd6ed3` and this context docs update (nothing pushed;
nothing applied to DigitalOcean); the tree was clean at `2d4b98b` (the
`DEC-083` contract-step handoff) before the slice. **5 commits** in order:
`feat(persistence)` — the `file_object` table (migration `0035`) + the
`import_run.file_object_id` FK (`NOT VALID` → `VALIDATE CONSTRAINT`) + the
`file_object_org_guard` trigger (migration `0036`) + repository/tests;
`docs(comments)` — stale `file_object`-absent comments corrected across
application/web (the five deferred file FKs stay plain uuids); `docs(runbook)`
— the `0035`/`0036` entries; `docs(decisions)` — `ADR-0006` accepted +
`DEC-085`; plus this docs(context) update.

- **Delivered (`DEC-085`, row-11 import-framework point 6 — row 11 is now
  complete):** the `file_object` platform table (`id`, `organization_id` FK,
  `storage_key`, `filename`, `mime`, `size_bytes bigint >= 0`,
  `checksum_sha256`, `retention_policy` provisional free text, `uploaded_by`
  (deferred `app_user` FK), `uploaded_at`,
  `linked_entity_type`/`linked_entity_id` polymorphic, audit columns) with
  `UNIQUE (organization_id, storage_key)`; `import_run.file_object_id` is now
  a real FK; cross-organization coherence is enforced by the
  `file_object_org_guard` trigger (the `DEC-079`/`DEC-081` precedent).
  `ADR-0006` was accepted by the owner 2026-09-21 (revertible; the retention
  periods per file class remain a privacy-review open item). `DEC-085`
  accepted. **Schema:** migrations through `0036`; **68 tables** (was 67).
  Next free decision id **`DEC-086`** (now `DEC-095`).
- **Rehearsal evidence (local dev DB):** apply → 68 tables, FK
  `convalidated=true`, guard present; orphan link → `23503`; cross-org link →
  `23514` (guard); duplicate `(organization_id, storage_key)` → `23505`;
  negative `size_bytes` → `23514`; down (`0036` then `0035`) → 67 tables,
  FK/trigger/function gone; ledger reset + re-apply → 68 tables, FK
  validated, trigger present. The migration files are pinned by sha256
  (unchanged after the rehearsal).
- **Reviews and reconciliation.** `reviewer-qwen` — **no blocker/major**;
  **accepted and applied** its 3 minors (a `ponytail:` `size_bytes` 9 PB
  ceiling comment; a `checksum_sha256` format/upgrade comment; a
  null-`file_object_id` guard test). `reviewer-glm` — **no blocker/major**;
  **accepted and applied** M1 (`DEC-085` said "four" deferred file columns —
  there are **five**, including `waste_event.photo_file_id`); **declined with
  reason** M2 (an order warning in the `0035` down header — the runbook
  already documents the down order and editing the pinned down file would
  invalidate the rehearsal for no semantic gain); M3 was this CONTEXT
  rewrite.
- **Verification (at HEAD `ebd6ed3`, exact):** `typecheck`, `lint`,
  `format:check`, `build` clean; **1383/1383 tests with `DATABASE_URL`** (136
  files); `npm audit --omit=dev` = 0; `db:migrate` through `0036` is a no-op
  on re-run; 68 tables.
- **Next step:** no unblocked TECH-owned slice remains — **row 11 is
  complete** and the remaining roadmap items are gated (the receipt→ledger
  wiring on the OPS `storage_area_id` policy; row 13 on I11; row 14 on the
  privacy review; rows 15–18 blocked; the deployment rehearsal on owner
  inputs; the golden fixtures unsigned). Candidate small unblocked TECH open
  points are recorded and unscheduled (see "Resume here"). Next free decision
  id **`DEC-086`**.

Rollback: each of the five commits is independently `git revert`-able (revert
the docs commits before persistence if reverting a cohort); migration `0035`
adds one table and `0036` a trigger, both with rehearsed unjournaled down
paths — the down order is `0036` then `0035`; if the DB is rolled back,
delete the `0035`/`0036` ledger rows (`created_at` `1789990745770` /
`1789990766802`) and re-migrate (68 tables); nothing pushed; nothing applied
to DigitalOcean.
