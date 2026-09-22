# 2026-09-20 — Row 11 (import framework + external mappings) complete + cross-cutting error-handling fix (uncommitted); handoff updated

`main` HEAD `7f6aa78`; the working tree holds uncommitted **row 11** work plus a
cross-cutting error-handling fix and this handoff update — about to be committed
as **three commits** (row 11, the error fix, docs; nothing pushed; nothing
applied to DigitalOcean). No handoff/code file outside `CONTEXT.md` and
`docs/BUILD_ROADMAP.md` was touched by this update.

- **Row 11 — complete.** Migration `0022` (tables `import_run`,
  `import_staging_row`, `external_mapping`), vocabularies
  `IMPORT_STATUS`/`MAPPING_STATE`/`IMPORT_POSTING_POLICY`, domain
  `packages/domain/src/sales-mapping.ts` (`resolveExternalEntity` — SKU-first
  then external id, with both `DEC-033` conflict directions), application
  `packages/application/src/imports/**` (create/stage/validate/map/dispose/
  preview + list/get), web `/api/v1/imports/**` and `(app)/sales/**` (landing +
  import runs list + run detail with diagnostics, staging rows, dispositions
  and preview), and `apps/web/scripts/seed-imports.ts`. **Row 12 (sales +
  settlements + reconciliation) was deliberately NOT built** — it remains
  `blocked (owner)` on `ADR-0008` (still Proposed); the import slice stops at
  `validated`/`needs_review` and the `/sales` page marks Reconciliation "not
  yet implemented — row 12 is owner-gated on ADR-0008". `ADR-0007` (Proposed)
  still gates row 13.
- **Cross-cutting fix (uncommitted).** `apps/web/lib/http.ts` `jsonError` now
  takes a message and `mapErrors` maps `DomainError`→400 with the authored
  message; all ~40 non-auth `DomainError` branches pass `error.message`; auth
  routes stay generic (`ADR-0003`). Verified live: a duplicate import hash now
  returns `{"error":"duplicate import file hash …"}` instead of "Invalid email
  or password".
- **Open points recorded, not decided** (see "Open decisions / inputs" and
  `docs/BUILD_ROADMAP.md` §5 "Row-11 import-framework open points"): the
  row-12/13 gates; the sales/consumption grain ambiguity (`DEC-009`
  daily-per-location vs a single `sales_line` `source_id`); no import-profile
  table; no tolerance-configuration table; `file_object` absent so
  `file_object_id` is a plain uuid; dispositions in `diagnostics.dispositions`
  (no table); two routes return 404 by matching the text `/not found/i` on the
  `DomainError` message (`recipes/[id]`, `recipes/[id]/versions`) — a brittle
  pattern to replace with a typed not-found error; `MAPPING_STATE` has no
  `conflict` value (conflicts are `error` + `error_code=mapping_conflict`);
  next free decision id `DEC-072`. A live-check left one dev `import_run` row
  in the local database (local dev-data artefact, no repository impact).
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `build`, `format:check` clean; **1087/1087 tests with `DATABASE_URL`** (880
  passed / 207 skipped without); `npm audit --omit=dev` 0; `db:migrate` through
  `0022` is a no-op; the `0022` down path was rehearsed.

Rollback: the row-11 work + the error fix are uncommitted — `git checkout --
<paths>` / discard the tree (or `git revert` the three commits once they land);
migration `0022` is additive with a rehearsed down path. Next: the three
commits, then row 12 when `ADR-0008` is accepted (else the price-version work
`DEC-064` / the deployment rehearsal) — see "Resume here".
