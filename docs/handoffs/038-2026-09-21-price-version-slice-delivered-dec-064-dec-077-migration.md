# 2026-09-21 — Price-version slice delivered (DEC-064/DEC-077, migration 0027); handoff updated

`main` HEAD `80bbe1c`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean). **5 commits**
this slice: `4e755a0` docs(decisions) accept `DEC-077`; `e94dfe1` feat(domain)
price-version effective-window helpers; `414832b` feat(persistence)
`price_version` (migration `0027`) + repository incl. the approval CAS;
`e2bd2b1` feat(application) price-version approval and reads
(`DEC-064`/`DEC-077`); `80bbe1c` feat(web) price-version approval action and
versions screen.

- **Delivered:** the price-version slice (`DEC-064`, `DEC-077`, PRICE-002/003)
  — the `price_version` table (half-open `[effective_from, effective_to)`,
  non-overlapping per `(organization_id, product_variant_id, location_id,
channel_id)` via a hand-written EXCLUDE with a COALESCE sentinel so a null
  location/channel is a single "any" scope); `approvePriceScenario` creates an
  effective version for the scenario's scope in the same transaction, rejects
  a null price and an overlapping window, and uses the compare-and-swap
  `approvePriceScenarioIfApprovable` state transition so a concurrent approval
  cannot double-create; only an approved scenario yields a version
  (PRICE-003); application reads `listPriceVersions`/`getPriceVersion`; web
  approve route + price-versions API + Costs UI approval action and
  Price-versions screen.
- **Adversarial reviews and reconciliation.** Two independent passes:
  `reviewer-qwen` and `reviewer-minimax`. **Accepted and applied:** the
  concurrent-approval race (fixed with the CAS;
  `approvePriceScenarioIfApprovable` + regression tests). **Declined as
  consistent-with-convention or legitimate:** the persistence-finder
  org-scoping (matches `findCostCard`; the application guards the org) and the
  "zero price allowed" note (free/zero-price items are legitimate per
  `DEC-043`). `reviewer-minimax` reported no findings (the EXCLUDE with the
  COALESCE sentinel verified correct, migration/journal/snapshot consistent,
  schema drift none).
- **Verification at `80bbe1c` (exact):** `format:check`, `typecheck`, `lint`,
  `build` clean; **1269/1269 tests with `DATABASE_URL`** (132 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0027` is a no-op on
  re-run; the `0027` down path rehearsed; **64 tables**; every new
  read/write organization-scoped (`DEC-061`).
- **Resume task:** `DEC-078` — the `settlement.status` /
  `reconciliation.scope_type` vocabularies + `lotTracked` enforcement, then
  the receipt→ledger wiring if the OPS policy lands — see "Resume here". A
  dev server was running at http://localhost:3000
  (owner/LocalDevPass123, demo-seeded); a fresh session must restart it
  (session-scoped).

Rollback: each commit is independently `git revert`-able; migration `0027` is
additive with a rehearsed unjournaled down path (drop the constraint and the
table, delete the ledger row, re-migrate); no data migration; nothing pushed;
nothing applied to DigitalOcean.
