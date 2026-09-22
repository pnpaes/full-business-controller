# 2026-09-20 — Inventory balances show the item name/code instead of the raw UUID (uncommitted)

Closed the gap where the new Inventory screen displayed raw item UUIDs because the
inventory read model did not expose the item name/code. No domain/persistence
logic change — the persistence `findItemById` already returned the full row.

- `InventoryItemRecord` gained `code`/`name`
  (`packages/application/src/inventory/types.ts`), mapped in `toItem`
  (`postgres-store.ts`) and seeded in `FakeInventoryStore`'s fixture
  (`test-support.ts`); the inline item literals in `post-stock-movement.test.ts`
  were updated so they still compile.
- `BalanceRow` gained `itemCode`/`itemName` from the existing org-checked item
  lookup, so `GET /api/v1/inventory/balances` now carries them
  (`apps/web/app/api/v1/inventory/balances/balance-rows.ts`); its test updated.
- `BalancesTable` renders the item name (the code as a small muted secondary line)
  with the id kept in a `title`, and the "names are not exposed yet" caption /
  row comment were removed; the `—`/empty behaviour and the currency logic are
  unchanged (`apps/web/app/(app)/inventory/balances-table.tsx`, `page.tsx`).

Verified (exact): `npm run typecheck`, `npm run lint` pass; focused
`npx vitest run packages/application/src/inventory apps/web/app/api/v1/inventory`
= **55 passed / 4 skipped (59)**; `npm run test` = **568 passed / 135 skipped
(703)**; `npm run build` passes (the first attempt failed transiently on missing
auth page modules — the `next build`/running `next dev` shared-`.next` race — and
succeeded on retry); `npx prettier --check` clean on all eight touched files.
Curl: signed-out `GET /api/v1/inventory/balances` → **401**; signed in as
`owner`/`LocalDevPass123` → **200** with `itemCode`/`itemName` populated (e.g.
`DEMO_ESPRESSO_BEANS` / "Demo Espresso Beans"). Uncommitted; rollback: discard the
touched files/the working tree (or `git revert` once committed).
