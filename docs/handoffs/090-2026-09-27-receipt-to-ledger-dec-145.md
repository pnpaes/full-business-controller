# 090 — 2026-09-27 — Receipt → stock ledger wired (`DEC-145`, migration `0074`)

On branch `main`; **committed** as `50b231e` — working tree clean, **pushed** to
`origin/main`, nothing applied to DigitalOcean. Migration `0074`.

## What was decided and what was built.

The receipt→ledger integration had been gated on the OPS destination
`storage_area_id` policy since slice 8. `DEC-145` (accepted 2026-09-27) decided
it: **the receiving location's default storage area**, with an explicit
per-receipt override, failing closed when neither resolves. The recon found the
"default area per location" concept **did not exist**, so the slice introduces
it.

### Schema (migration `0074`, expand-only)

- `location.default_storage_area_id` uuid nullable (FK → `storage_area.id`) —
  the per-location fallback destination.
- `goods_receipt.storage_area_id` uuid nullable (FK → `storage_area.id`) — the
  explicit per-receipt override.
- Two hand-written `BEFORE INSERT OR UPDATE` coherence guards (`ERRCODE 23514`,
  forward-only, skipping when the guarded column is unchanged): the location
  default must be a `storage_area` of **that** location and organization, and a
  receipt override must be one of the receipt's own location and organization —
  the single-column FK only catches a missing row. No new table (99 public
  tables). Down companion drops the triggers/functions then the columns.

### Resolution + posting

- `recordGoodsReceipt` now resolves `input.storageAreaId ?? location.defaultStorageAreaId`
  and **fails closed** (a `DomainError` before any insert) when neither
  resolves; then, inside the receipt's existing transaction, posts **one
  `receipt` `stock_movement` per line** via `postStockMovement` with
  `sourceType: "goods_receipt"`, `sourceId: receipt.id`, the line's
  `baseQtyAccepted`/`landedBaseUnitCost`, the lot when present, and the
  idempotency key `receipt-<receiptId>-<lineId>` (hyphens — the ledger reserves
  `:` for its internal revaluation suffix), so a retry cannot double-post. The
  existing source guard already accepted `goods_receipt`.
- `ReceivingStore` **composes** `InventoryStore` (rather than extending it,
  because `ReceivingUnit` carries `isBase`, which the inventory shape lacks).

### Surfaces

- `POST /api/v1/receiving/receipts` accepts an optional `storageAreaId` override
  (malformed → 400).
- New `POST /api/v1/administration/locations/default-storage-area` (owner /
  general_manager / admin, own limiter) backed by the new
  `setLocationDefaultStorageArea` command — there was no location write command
  to extend.

## Commit basis.

Single commit `50b231e` (`feat(inventory,receiving)`); reverts independently,
with `0074`'s down file.

## Verification.

`npm run typecheck`, `npm run lint`, `npm run format:check` clean;
`npm run build` exit 0; `DATABASE_URL=… npm run test` → **5093/5093 (370
files)**; `db:migrate` applied `0074` and is a no-op on re-run. On a **scratch
DB** (never the dev DB): both columns and both guards present, the guards proven
to reject a cross-location default and a cross-location receipt override, the
down path applied (columns + triggers gone, 99 tables remain), scratch dropped.
Tests cover override-beats-default, default resolution, fail-closed with neither,
one movement per line with the resolved area, and no double-post on retry.

## Deferred / recorded.

- No receipt-level idempotency key: a repeated `recordGoodsReceipt` call creates
  a new receipt by design (only the movement level is deduped).
- `location.default_storage_area_id` has no UI beyond the Administration route;
  a register-screen affordance is a later nicety.
- Row 17 (AI advisory), row 18 (connectors: public websites + Wolt), reset
  delivery via Resend (`DEC-147`) and the `WF-003` employee login (`DEC-146`)
  remain the next buildable fronts; the deployment rehearsal stays parked
  (`DEC-148`).

## Rollback.

Run `0074_receipt_stock_ledger_area_down.sql` (drops the guards then the two
columns — no ledger row is touched), then `git revert 50b231e`; pre-`0074`
receipts revert to posting nothing.
