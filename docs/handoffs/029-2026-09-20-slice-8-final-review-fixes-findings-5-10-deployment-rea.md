# 2026-09-20 — Slice 8 final review fixes (findings 5–10) + deployment readiness (uncommitted)

Finished the slice-8 adversarial-review follow-up on the still-uncommitted working
tree (HEAD `f7b1db7`; nothing applied to DigitalOcean): **all ten review findings
are now addressed.** No new domain change beyond the earlier fixes.

- **Findings 5–10 fixed.** Batch posting memoises transaction-immutable reference
  lookups inside the transaction; `getStockBalanceAsOf` uses the new SQL aggregate
  `sumStockMovementsAsOf` (no in-memory ledger scan) plus the domain average
  helper; migration `0019_stock_movement_asof_index.sql` (journal `when`
  `1789904976754`) adds the `stock_movement_org_occurred_idx` index on
  `(organization_id, occurred_at, posted_at, id)`; the negative-override guard and
  `isBlank` are de-duplicated; the dead wrapper `getCurrentStockBalance` and the
  test-only persistence exports (`createStockLot`, `findStockLotByNumber`,
  `listStorageAreas`) were removed. `listStockMovements` is deliberately retained
  as a ledger read API (now used only by its persistence test; slice 9 will need
  it). Findings 1–4 were fixed earlier (DEC-010 gate, per-org idempotency `0018`,
  domain `deriveAverageUnitCost`, shared `postRevaluationCorrection`).
- **Deployment readiness (infra).** `ORGANIZATION_ID` (general) and
  `TOTP_SECRET_ENCRYPTION_KEY` (secret) are wired conditionally into the
  app-platform module and both env roots (unset adds no env var), web-only;
  `docs/runbooks/deployment.md` updated (deployed env vars, the corrected
  owner-decision drift — multi-tenancy decided `DEC-061`, jobs runtime decided
  `DEC-062`, `ADR-0004` acceptance itself still open — and a "Rehearsing against
  a production clone" note). Runbook `0019` entries added to
  `docs/runbooks/persistence-migrations.md`.
- **Local deployment rehearsal (this session).** The full suite and migration are
  green; `npm run bootstrap -- --dry-run` prints the expected plan without
  writing; the worker and scheduler smoke ticks pass only when `DATABASE_URL` is
  set (the "How to verify" commands here were corrected to include it). Docker
  and Terraform binaries are not on PATH here, so the container build and
  credentialed Terraform steps could not run (Terraform offline validation ran
  from a downloaded 1.16.3 binary by the infra agent).

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **558 passed / 135 skipped
(693)**; with it **693 passed / 693 (69 files)**; `npm audit --omit=dev` = 0;
`db:migrate` applies through `0019` and re-runs as a no-op; the `0019` down path
was rehearsed (drop the index, delete the ledger row, re-migrate). Terraform:
`fmt -check -recursive` clean; `init -backend=false` + `validate` green in both
envs; offline plan still **16 to add / 0 change / 0 destroy** per env.

Rollback: discard the working tree (or, once committed, `git revert`); migrations
`0018`/`0019` are additive with rehearsed down paths; the infra env-var change is
additive and changes no plan count. Next: the atomic slice-8 commit (see "Resume
here"), then the test-deployment rehearsal.
