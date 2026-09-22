# 2026-09-20 — DEC-072–076 accepted and implemented; low-risk open points closed; handoff updated

`main` HEAD `c0b0d77`; the working tree holds only this handoff update — the
seventh commit of the session (nothing pushed; nothing applied to
DigitalOcean). **7 commits** since the previous session baseline `bcb625a`:
`aaec400` docs(decisions) accept `DEC-072`–`DEC-076`; `dcec861` chore(lint)
ignore Agent Manager worktrees under `.kilo/`; `44eb93a` feat(domain) typed
`NotFoundError` + `toleranceAmount`; `6ff5881` feat(persistence)
`reconciliation_tolerance` (0024) + `MAPPING_STATE` `conflict` (0025) +
`sales_line_reversal_of_id_key` (0026); `301c381` feat(application)
effective-dated tolerance resolution + mapping conflict + `reverseSalesLine` +
typed recipe 404s; `c0b0d77` feat(web) recipe 404s by `NotFoundError` +
`conflict` label; plus this docs commit.

- **Delivered:** five accepted decisions and their low-risk implementations.
  `DEC-072` the effective-dated `reconciliation_tolerance` table (migration
  `0024`), tolerance = `max(rate × |expected|, floor_amount)`, precedence:
  explicit override → effective config at period end → explicit `DEC-026`
  default opt-in → block close (`reconciliation.tolerance` stays the per-row
  snapshot); `DEC-073` `reverseSalesLine` — a new negated `sales_line` in the
  same transaction with `reversal_of_id`, a mandatory reason and no stock
  posting, race-safe via `sales_line_reversal_of_id_key` (0026); `DEC-074`
  `MAPPING_STATE` gains `conflict` (0025) — `DEC-033` conflicts write
  `conflict` with `error_code=mapping_conflict` retained; `DEC-075`
  `tax_rule_id` is canonical and `applied_tax_rate` is the source-reported
  applied rate (docs-only); `DEC-076` the typed `NotFoundError` replaces the
  `/not found/i` match in the recipe page + GET/POST routes.
- **Adversarial reviews and reconciliation.** Two independent passes:
  `reviewer-qwen` and `reviewer-minimax`. **Accepted and applied:** the
  sales-line reversal race fix (`sales_line_reversal_of_id_key`, 0026) and the
  runbook lock-name/preflight fixes. **Declined as false positives (with
  evidence):** the "EXCLUDE misses open-ended windows" claim (empirically the
  constraint rejects two `effective_to IS NULL` rows) and the "rate silently
  truncated" claim (`parseDecimal` throws on extra precision); the `DEC-076`
  scope-expansion claim was declined (the decision is scoped to the recipe
  routes).
- **Verification at `c0b0d77` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1214/1214 tests with `DATABASE_URL`** (128 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0026` is a no-op on
  re-run; migrations `0024`–`0026` down paths rehearsed; **63 tables**; every
  new read/write organization-scoped (`DEC-061`).
- **Resume task:** the price-version slice (`DEC-064`, PRICE-002/003) — see
  "Resume here". A dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migrations `0024`–
`0026` are additive with rehearsed down paths (`0024` down drops the table +
EXCLUDE constraint; `0025` down restores the four-value checks — it fails if
`conflict` rows exist, preflight documented; `0026` down drops the partial
unique index); the eslint-ignore change and the docs commits are trivial
reverts; no data migration; nothing pushed; nothing applied to DigitalOcean.
