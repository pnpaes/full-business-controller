# 2026-09-21 — Three small TECH open points closed + Phase A of the HMS/personnel-documents programme approved (DEC-086…DEC-094); handoff updated

`main` HEAD `02f7c33`; the session's work is committed as four commits —
`bda0b6b`, `8b22468`, `02f7c33` and this context docs update (this is the 4th
commit; nothing pushed; nothing applied to DigitalOcean); the tree was clean
at `ebd6ed3` (the `file_object` slice handoff) before the work. **4 commits**
in order: `fix(domain)` — `parseDecimal` caps at the `numeric(19, scale)`
precision (money `numeric(19,4)`, quantities `numeric(19,6)`), new
`packages/domain/src/decimal.test.ts`; `chore(vocabularies)` — the
`import_disposition` key added to `schemas/domain-enums.yaml`, the
`YAML_ABSENT_VOCABULARIES` exemption removed; `test(counts)` —
`FakeCountStore.withTransaction` now snapshots/restores (rollback test); plus
this docs(context) update carrying **Phase A** of a new owner-approved
programme.

- **Delivered (three small TECH open points closed):** the `numeric(19,
scale)` digit cap in `packages/domain/src/decimal.ts` (`bda0b6b`); the
  `IMPORT_DISPOSITION` yaml key (`8b22468`; the `DEC-083`-review point
  (iii)); the `FakeCountStore.withTransaction` rollback-fidelity gap
  (`02f7c33` — snapshot/restore the count + inventory + exception maps like
  `FakeProductionStore`). No schema change — **68 tables** (unchanged);
  migrations through `0036`.
- **Delivered (Phase A — this docs commit):** the owner approved
  (2026-09-21) an HMS & food-safety (IK-mat) module, employee personnel
  documents (contracts) and a staff document library — recorded as
  `DEC-086`…`DEC-094` in `12_OPEN_DECISIONS.md`; scope amended in
  `01_PRODUCT_SCOPE.md` (the food-safety non-goal overturned); new
  requirement ids `WF-007`, `DOC-001…DOC-004`, `HMS-001…HMS-007` + phase
  map; delivery Phase 6 + Epics 20/21; access-matrix rows + retention notes
  in `07_SECURITY_AND_NFR.md`; new screens in `08_UI_UX.md`. Owner-agreed
  rules: contracts visible only to Owner + general_manager + admin (finance
  excluded); staff documents all-staff read published `all_staff` docs,
  managers publish (versioned, optional acknowledgement); full IK-mat
  package; privacy review approved.
- **Reviews and reconciliation.** `reviewer-qwen` on Phase A — one blocker
  (`DEC-094` wrongly claimed to accept the Proposed `ADR-0004`; fixed:
  `task`/`approval` build now, the `job`/worker/outbox layer stays gated on
  `ADR-0004` acceptance) and several consistency fixes applied (next-free-id,
  `DEC-090` cross-ref, access-matrix clarity, the WF-003 login gap noted,
  append-only semantics, the phase↔epic note, asset→equipment rename).
  `reviewer-glm` on the `decimal.ts` cap — no blocker/major, boundary tests
  added.
- **Verification (at HEAD `02f7c33`, exact):** `typecheck`, `lint`,
  `format:check`, `build` clean; **1398/1398 tests with `DATABASE_URL`** (137
  files); `npm audit --omit=dev` = 0; `db:migrate` through `0036` is a no-op
  on re-run; 68 tables.
- **Next step:** the **HMS monitoring points + readings** slice
  (`monitoring_point` + `monitoring_reading`, `DEC-089`) — the first build
  step of the IK-mat package; then the programme build order (incidents +
  corrective actions `DEC-090`, `employee` + personnel documents `DEC-087`,
  staff document library `DEC-088`, checklists/cleaning `DEC-091`,
  equipment/maintenance `DEC-092`, compliance export `DEC-093`,
  `task`/`approval` `DEC-094` with the `job`/worker/outbox layer gated on
  `ADR-0004`). Next free decision id **`DEC-095`**.

Rollback: each of the four commits is independently `git revert`-able; no
migration was touched (migrations stay through `0036`, 68 tables; Phase A is
docs-only); nothing pushed; nothing applied to DigitalOcean.
