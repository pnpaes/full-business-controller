# 2026-09-20 — Slice-7 review-fix commits (`c82a30f`, `083106a`); five owner decisions + `ADR-0005` accepted; handoff updated

Two atomic commits on `main` since the last handoff update (which recorded the
slice-7 review fixes as an uncommitted working tree at HEAD `60f3ec5`; the tree is
now clean at HEAD `aa4ab29`; nothing applied to DigitalOcean):

- **`c82a30f` — cross-organization reference guards + runbook `0015`/`0016`.**
  Committed the two accepted slice-7 review fixes: `calculateCostCard` and
  `calculatePriceScenario` now org-check every reference (not just
  `productVariantId`) inside `withTransaction`, throwing
  `DomainError("<ref> belongs to another organization")` / `"<ref> not found"`;
  ports gained `findLocation`/`findChannel`/`findRecipeVersion`; and
  `docs/runbooks/persistence-migrations.md` documents migrations `0015`/`0016`
  (order, bullets, down companions, ledger keys, corrected recovery range
  `0000–0016`).
- **`083106a` — pricing-primitive wiring + preflight notes.** Wired the pinned
  domain pricing primitives into the price-scenario outcome, removed two dead
  read APIs, de-duplicated the contribution boundary onto the domain primitive,
  and added the `0014`/`0016` pre-apply preflight notes to the deployment
  runbook. No migration touched.

Owner actions this session: **`ADR-0005` (stock valuation/consumption) is
Accepted** — slice 8 (stock ledger + balances + lots/storage) is unblocked and is
the next task. Five new decisions in `12_OPEN_DECISIONS.md`: `DEC-061`
(multi-tenancy: shared schema with `organization_id` row scoping, RLS possible
later, no schema/DB-per-tenant), `DEC-062` (jobs runtime: pg-boss over the existing
PostgreSQL, worker/scheduler long-lived), `DEC-063` (price-scenario target =
contribution over net price, 6 dp fraction), `DEC-064` (`price_version` +
PRICE-002/003 are the next pricing slice after slice 8), `DEC-065` (golden
fixtures are machine-readable JSON under `tests/fixtures/`; the sign-off trail is
prepared — six files, the reconciliation test
`packages/domain/src/golden-fixtures.test.ts`, and the sign-off mechanics).
Decision count is now 65; next free id `DEC-066`.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **475 passed / 113 skipped
(588)**; with it **588 passed / 588 (60 files + the new golden-fixture test)**;
`npm audit --omit=dev` = 0.

Rollback: `git revert c82a30f` or `git revert 083106a` independently — neither
touched a migration or generated file. Next: **slice 8 — stock ledger + balances +
lots/storage** (see "Resume here").
