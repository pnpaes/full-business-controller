# 2026-09-20 — Slices 9 + 10-backend complete (uncommitted); decisions DEC-066–DEC-071 recorded; slice-10 web layer in flight

Slices 9 (counts + transfers + waste) and 10 (production planning + batches)
backend are **complete but UNCOMMITTED** at HEAD `2a5799e` (docs commit; nothing
pushed; nothing applied to DigitalOcean). They were built **concurrently in
parallel** and share barrel files
(`packages/application/src/index.ts`, `packages/domain/src/index.ts`,
`packages/persistence/src/index.ts`, `packages/persistence/src/schema/index.ts`,
`packages/persistence/src/schema/vocabularies.ts`, `drizzle/_journal.json`), so
they **cannot be split into independently-buildable commits** — the commit plan is
one **stock-ops commit** (slice 9 + the slice-10 backend) plus a separate
**production-web commit**.

- **Slice 9 (counts + transfers + waste) — complete.** Persistence was already
  committed (migration `0020` in `b525f30`); this session added the three
  application verticals with APIs, screens, seeds and tests:
  `packages/application/src/{counts,transfers,waste}/**`,
  `apps/web/app/api/v1/{counts,transfers,waste}/**`,
  `apps/web/app/(app)/inventory/{counts,transfers,waste}/**`,
  `apps/web/scripts/seed-{counts,transfers,waste}.ts`. A transfers-seed type error
  was found and fixed during integration (`apps/web/scripts/seed-transfers.ts`).
- **Slice 10 backend — complete.** Migration `0021` (tables `production_plan`,
  `production_batch`, `production_batch_input`, `production_batch_output`;
  `waste_event.production_batch_id` FK; source guard extended to
  `production_batch`), `packages/domain/src/production.ts` (yield helpers),
  `packages/application/src/production/**` (plan/batch commands incl. the atomic
  `completeProductionBatch`). Its **web layer** (API + `/production` screens +
  seed) is in flight.
- **Decisions recorded (docs commit `2a5799e` + this update):**
  `DEC-066` transfers = header + paired `stock_movement.transfer_id` movements, no
  line table, derived discrepancy, `discrepancy_note` as the interim exception
  record; `DEC-067` positive count variance valued at caller `unit_cost` →
  `item.current_cost`, approval fails with neither (provisional, FIN);
  `DEC-068` operational waste valued at the ledger's moving weighted average at
  posting (`cost_selection`/`latest_price`/`manual` unimplemented); `DEC-069`
  production batch identity/idempotency = the caller-supplied deterministic id
  until OPS+TECH define a numbering scheme; `DEC-070` expected trim/cooking loss
  never posts a `waste` movement, only actual abnormal loss becomes a
  `waste_event`; `DEC-071` provisional local `production_batch_output.kind`
  vocabulary pending a `domain-enums.yaml` key. Open owner questions (not
  decisions) recorded in `docs/BUILD_ROADMAP.md` §5 "Slice-9/10 open owner
  questions"; next free decision id `DEC-072`.
- **Verification (exact, at the current working tree):** `typecheck`, `lint`,
  `format:check` clean; **989/989 tests with `DATABASE_URL`** (the full suite
  including the slice-9/10 integration tests); `db:migrate` applies `0020` and
  `0021`, both no-ops on re-run; both down paths rehearsed.

Rollback: the slice-9/10 work is uncommitted — `git checkout -- <paths>` / discard
the tree (or `git revert` the stock-ops/production-web commits once landed);
migrations `0020`/`0021` are additive with rehearsed down paths. Next: finish the
slice-10 web layer, review/fix, commit (stock-ops, then production-web), then the
sales-import/reconciliation slice (see "Resume here").
