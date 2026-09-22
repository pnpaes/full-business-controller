# 2026-09-20 — Slice 8 + slice-9 persistence + design system/screens committed (five layer commits); slice 9 Wave 2b in flight

Five commits landed on `main` (HEAD now `6c69f7f`; nothing pushed; previous HEAD
`f7b1db7`). Because the migrations/schema barrels shared files across tasks, the
backlog was committed in dependency-ordered **layer commits**
(persistence → domain → application → web/ui → infra — infra commit chronologically
topmost as the last stack entry); **per-task feature commits resume from here**:

- `583da3f` feat(infra) deploy env vars (`ORGANIZATION_ID`,
  `TOTP_SECRET_ENCRYPTION_KEY` wired conditionally into the app-platform module and
  both env roots).
- `b525f30` feat(persistence) stock ledger + stock-ops schema, repositories,
  migrations `0017`–`0020` (slice 8 plus the slice-9 stock-ops tables:
  `stock_count`/`stock_count_line`/`stock_transfer`, `stock_movement.transfer_id`,
  the `0017` source guard extended to `stock_count`/`transfer`/`waste_event`).
- `40e736b` feat(domain) stock valuation + client-safe subpath exports
  (`@aquarela/domain/decimal|quantity|money`).
- `c91e512` feat(application) inventory/catalog/recipes/costing/receiving slices.
- `6c69f7f` feat(web) Aquarela design system (`packages/ui` shell + patterns +
  client-only modal), app shell with role-aware nav and scope bar, Management home,
  branded sign-in, styleguide, and the Inventory/Products/Recipes/Costs/Purchasing
  screens with `/api/v1` routes and idempotent seeds.

**Delivered and verified within these commits:** slice 8 stock ledger (moving
weighted-average valuation, reversal/revaluation, DEC-010 negative-stock manager
gate, per-org idempotency, SQL as-of aggregate) with migrations `0017`–`0019`;
the web surface above; slice 9 **persistence** with migration `0020`.
**Known defects fixed during integration:** a client component pulled `node:crypto`
into the browser bundle via the domain barrel (fixed with the client-safe
`@aquarela/domain/decimal|quantity|money` subpath exports); six detail pages
returned HTTP 500 on a non-UUID param (fixed with
`apps/web/lib/route-params.ts` → 404, with its test).

**Verification at `6c69f7f` (exact):** `typecheck`, `lint`, `build`,
`format:check` clean; **842/842 tests with `DATABASE_URL`** (691 passed / 151
skipped without it); `npm audit --omit=dev` = 0; `db:migrate` through `0020`
re-runs as a no-op; the `0017`–`0020` down paths rehearsed.

**In flight: slice 9 Wave 2b** — the counts, transfers and waste application +
`/api/v1` + screens, in three parallel background agents (each owning
`packages/application/src/{counts,transfers,waste}/**`,
`apps/web/app/api/v1/{counts,transfers,waste}/**`,
`apps/web/app/(app)/inventory/{counts,transfers,waste}/**` and
`apps/web/scripts/seed-*.ts`). **Programme direction (user instruction):**
proceed autonomously — per task: parallel background agents → review/fix →
document status + next steps → commit → next task; after slice 9, slice 10
(production planning + batches), then sales import/reconciliation, then
insights/month-close. **Open points recorded not decided** (13 — see
`docs/BUILD_ROADMAP.md` §5 "Slice-9 counts/transfers/waste open points" and "Open
decisions / inputs"); next free decision id `DEC-066`.

Rollback: `git revert <sha>` per commit (see "Reversibility" for the cohort
caveat); migrations `0017`–`0020` additive with rehearsed downs.
