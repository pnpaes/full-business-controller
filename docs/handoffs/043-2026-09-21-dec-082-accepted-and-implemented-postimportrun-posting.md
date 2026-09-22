# 2026-09-21 — DEC-082 accepted and implemented (postImportRun posting-policy enforcement); handoff updated

`main` HEAD `22b67c1`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean); the tree was
clean at `22b67c1` before this docs edit. **2 commits** this slice:
`12f0377` docs(decisions) accept `DEC-082`; `22b67c1` feat(sales) enforce the
import posting policy in `postImportRun`.

- **Delivered (`DEC-082`):** `postImportRun`
  (`packages/application/src/sales/post-import-run.ts`) now resolves the run's
  recorded `diagnostics.posting_policy` snapshot (absent/blank →
  `allow_partial` per `DEC-025`; a present value outside
  `import_posting_policy` → `DomainError` as corrupt). `allow_partial` is
  unchanged. Under `all_or_nothing` a **pre-write** check refuses the whole
  attempt with a `DomainError` naming the blocking `sourceRowNo`s, writes
  nothing and leaves the run's current status — unless every staging row is
  postable in this attempt, already linked to a sales line, or covered by an
  approved disposition (`DEC-035`). A row counts as resolved via any of those
  three. The run's own snapshot governs, not the profile's current value.
  Refusal is not file rejection (`DEC-025`'s "rejected outright" stays reserved
  for identity/period/currency/location validation failure). **No schema
  change:** migrations unchanged (through `0032`); still **66 tables**.
- **Reviews and reconciliation.** Two independent passes. `reviewer-qwen` —
  **no findings of any rank** (verified the pre-write placement, the complete
  resolution set, transaction-level atomicity, replay/idempotency, snapshot
  governance and the test strength). `reviewer-glm` — no blocker/major; **one
  minor accepted and applied** (a whitespace-only policy snapshot was untested —
  the test was added) and **one minor declined** (the inherited trust in
  `diagnostics.dispositions` records: it matches the import slice's documented
  "never interpret keys the slice did not write" convention and
  `reconcileImportRun`'s existing treatment; stray ids can only add
  resolutions, never cause a false refusal).
- **Review follow-up.** An independent `/review unpushed` pass over the slice
  (`ddc9e06..HEAD`) split into security, deploy-safety and business-logic
  tracks: security and deploy-safety **NO_FINDINGS**; business-logic raised
  **two findings, both accepted and fixed in `36f3c30`** — (1)
  `resolvePostingPolicy` now only accepts a string, so a non-string
  `diagnostics.posting_policy` (e.g. `["all_or_nothing"]`) is rejected as
  corrupt instead of `String()`-coerced; (2) an end-to-end `all_or_nothing`
  test now drives upload → stage → validate (`needs_review`) →
  `disposeStagingRow` → `postImportRun` (`partially_posted`). No migration or
  schema change (still 66 tables; migrations through `0032`). HEAD is now
  `36f3c30` (the slice is 4 commits: `12f0377`, `22b67c1`, `36094c6`,
  `36f3c30`).
- **Verification at `36f3c30` (exact):** `typecheck`, `lint`, `format:check`
  clean (`build` previously clean); **1362/1362 tests with `DATABASE_URL`**
  (135 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0032` is a no-op on re-run;
  **66 tables**; every read/write organization-scoped (`DEC-061`). New coverage:
  `allow_partial` unchanged; `all_or_nothing` + blocking row → refusal, no rows
  written, status unchanged, `updateImportRun` not called; `all_or_nothing` +
  dispositioned-only blocker → posts the subset, `partially_posted`;
  `all_or_nothing` all-postable → `posted`; `all_or_nothing` replay with all
  rows already linked → `posted`; out-of-vocabulary policy → rejected;
  whitespace-only policy → falls back to `allow_partial`; corrupt non-string
  policy snapshot → rejected.
- **Resume task:** move import dispositions from
  `import_run.diagnostics.dispositions` jsonb into a first-class `dispositions`
  table (row-11 import-framework point 7; additive migration `0033`+, rehearsed
  down path; record any needed decision from `DEC-083`) — see "Resume here". A
  dev server was running at http://localhost:3000 (owner/LocalDevPass123, MFA
  disabled for `owner`, demo-seeded including the `zettle-legacy`
  `import_profile`); a fresh session must restart it (session-scoped).

Rollback: each of the four commits is independently `git revert`-able;
`git revert 22b67c1` restores the previous posting behaviour and
`git revert 36f3c30` the pre-review snapshot handling; neither touches a
migration or generated file (no data-recovery concern); nothing pushed; nothing
applied to DigitalOcean.
