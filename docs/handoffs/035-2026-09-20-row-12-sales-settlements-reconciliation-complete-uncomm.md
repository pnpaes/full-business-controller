# 2026-09-20 — Row 12 (sales + settlements + reconciliation) complete (uncommitted); handoff updated

`main` HEAD `c324418` (the ADR-acceptance commit — `ADR-0007` and `ADR-0008`
accepted 2026-09-20, owner-delegated, revertible); the working tree holds
uncommitted **row 12** work plus this handoff update — about to be committed
(nothing pushed; nothing applied to DigitalOcean). No handoff/code file outside
`CONTEXT.md` and `docs/BUILD_ROADMAP.md` was touched by this update.

- **Row 12 — complete.** Migration `0023` (tables `sales_transaction`,
  `sales_line`, `settlement`, `reconciliation`; the `sales_line` branch added
  to the `stock_movement_source_guard`), vocabularies
  `RECONCILIATION_STATUS`/`OPTION_KIND`, domain
  `packages/domain/src/sales-consumption.ts` (recipe explosion + the `DEC-026`
  tolerance evaluator), application `packages/application/src/sales/**`
  (`postImportRun`, `postTheoreticalConsumption`, list/get) and
  `packages/application/src/reconciliation/**` (`reconcileImportRun`,
  `reconcileSettlement`, `resolveReconciliation`, list, `resolveTolerance`),
  web `/api/v1/sales/**` and `/api/v1/reconciliations/**` plus the
  `(app)/sales/**` screens (landing, transactions list/detail, reconciliation
  with resolve), and `apps/web/scripts/seed-sales.ts`. A pre-existing inventory
  test that posted a `sales_line` movement with a fake source id was fixed
  (the new guard correctly rejects it).
- **Roadmap position.** Row 12 `done (uncommitted)` in `docs/BUILD_ROADMAP.md`
  §4; row 13 is now only **data-gated** on history/grain quality (I11); row 14
  is owner-gated on the privacy review / access matrix; rows 15–18 remain
  blocked (data / `ADR-0009`–`0011`) — **no roadmap slice is buildable purely
  from code** without owner inputs or real history. Next unblocked task:
  resolve the recorded open owner questions as decisions (`DEC-072`+) and
  implement the low-risk ones — e.g. a tolerance-configuration table
  (`DEC-026` effective-dated config), sales-line reversal semantics
  (`DEC-028`), a typed not-found error replacing the brittle `/not found/i`
  matching in `recipes/[id]`/`recipes/[id]/versions`, a `MAPPING_STATE`
  `conflict` value, and the `tax_rule_id`/`applied_tax_rate` naming question;
  next free decision id `DEC-072`.
- **Open points recorded, not decided** (see "Open decisions / inputs" and
  `docs/BUILD_ROADMAP.md` §5 "Row-12 sales/reconciliation open points"):
  consumption grain A1 (`DEC-009` daily-per-location vs a single `sales_line`
  source); no tolerance-config table (`DEC-026` hardcoded); `tax_code_id` vs
  `tax_rule_id` + `applied_tax_rate` authority (A4); `DEC-028` sales-line
  reversal not implemented; `settlement.status` and
  `reconciliation.scope_type` have no vocabulary; the `sales_line`-guard test
  fix; the legacy I19 import carries no resolvable `location_id` (the demo
  theoretical consumption posts zero recipe-bearing lines); a local dev-DB
  side effect (the demo import run left `partially_posted` and a
  reconciliation reopened to `pending`).
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `build`, `format:check` clean; **1186/1186 tests with `DATABASE_URL`**
  (127 files); `npm audit --omit=dev` 0; `db:migrate` through `0023` is a
  no-op; the `0023` down path was rehearsed.

Rollback: the row-12 work is uncommitted — `git checkout -- <paths>` / discard
the tree (or `git revert` the commit once it lands); migration `0023` is
additive with a rehearsed down path. Next: commit row 12, then the `DEC-072`+
decisions + low-risk implementations — see "Resume here".
