# 2026-09-20 — Detail pages return 404 (not 500) for a non-UUID route param (uncommitted)

Fixed the cross-cutting defect where all six `(app)` detail pages returned **HTTP
500** for a malformed route param (`/inventory/notauuid`, `/products/notauuid`,
`/recipes/notauuid`, `/costs/cost-cards/notauuid`, `/costs/price-scenarios/notauuid`,
`/purchasing/receipts/notauuid`): the raw param reached a Postgres `uuid`
comparison and raised a driver error.

- New `apps/web/lib/route-params.ts` exports `uuidOrNotFound(value)`: trims,
  matches a strict 8-4-4-4-12 hex UUID (version/variant nibbles unconstrained),
  and calls `notFound()` on a miss; JSDoc states an unvalidated id must never
  reach the database. New focused test `apps/web/lib/route-params.test.ts`
  (valid, uppercase, wrong-length, non-hex, surrounding whitespace) = **5 passed**.
- Applied in all six detail pages before any store/service call, via a
  `raw<Param>` destructure rename (`uuidOrNotFound(rawId)`), keeping the existing
  `notFound()` for valid-but-unknown ids. No API route, domain/application/
  persistence layer, or `packages/ui` change. A sweep of `apps/web/app/(app)/**`
  confirmed exactly these six dynamic pages.
- Verified: `npx tsc --noEmit -p apps/web/tsconfig.json` clean; focused
  `npx vitest run apps/web/lib/route-params.test.ts` = 5 passed; `npx eslint` and
  `npx prettier --check` clean on all touched files. Live (dev server, signed-in):
  all six `…/notauuid` URLs now **404** (were 500); valid ids for inventory,
  products, recipes and purchasing/receipts **200**. The `cost_card` /
  `price_scenario` tables are empty in the dev DB (list API returns no rows), so
  no 200 id exists there; a valid-but-unknown UUID returns a clean **404**, i.e.
  the guard passes well-formed ids to the loader and never 500s. Uncommitted;
  rollback: discard the touched files (or `git revert` once committed).
