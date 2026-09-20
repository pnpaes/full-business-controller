import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { stockMovement } from "./inventory";
import { location, organization, storageArea } from "./organization";
import { TRANSFER_STATUS } from "./vocabularies";

/*
 * ponytail: slice-9 open points — recorded here, deliberately NOT resolved.
 * The same list is in `docs/runbooks/persistence-migrations.md` ("Known
 * follow-up obligations"). Do not invent a resolution for any of these.
 *
 * (a) There is **no transfer line table** in any authority
 *     (`schemas/phase1_2_draft.sql` defers only `stock_count`,
 *     `stock_count_line` and `transfer`; `DATA_DICTIONARY` §6 lists the
 *     `transfer` header only). The model is therefore a header plus paired
 *     `stock_movement` rows linked by `stock_movement.transfer_id`
 *     (DEC-029): a dispatch movement source → transit and a receipt movement
 *     transit → destination. Per-item dispatched-vs-received discrepancies
 *     therefore live on the movements (and `discrepancy_note` on the header),
 *     not on lines. A future owner decision may add a line table; until then
 *     do not invent one. The paired movements are read back with
 *     `listStockMovementsByTransferId` (`repositories/transfers.ts`); the source
 *     guard in `0020` validates the header reference for `source_type = 'transfer'`.
 * (b) Whether a **positive count variance** (a count-discovered surplus) needs a
 *     `unit_cost` to be valued is undecided, and if so where that cost comes
 *     from. `stock_count_line` therefore stores only `expected_qty`/`counted_qty`/
 *     `variance_qty`; no valuation column is invented. The count-adjustment
 *     movement's cost source is an application/owner decision.
 * (d) The `stock_count.scope` **jsonb shape and the recount thresholds are
 *     undefined** in every authority; `scope` is stored as opaque jsonb and
 *     `recount` as a boolean fact. Do not invent a scope schema.
 * (e) **Per-source reversal semantics (DEC-028) are not implemented in
 *     `reverseStockMovement` yet.** A non-receipt reversal posts movement type
 *     `correction`; only `receipt` maps to `receipt_reversal`. The slice-9
 *     sources (count adjustment, transfer, waste) have no dedicated reversal
 *     behaviour, and the "blocked when reconciled downstream sales depend on the
 *     original" gate is deferred to the sales slice.
 * (f) There is no **exception table** for transfer discrepancies (DEC-029 says
 *     "dispatched-vs-received differences become exceptions", but no exception
 *     table exists in any authority and `data_quality_exception` is deferred).
 *     `discrepancy_note` is the only recorded difference today.
 *
 * (c) the waste-event `value_method`/`value` vs the ledger moving-average
 *     outbound value is recorded in `./waste.ts`.
 */
export const stockTransfer = pgTable(
  "stock_transfer",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    fromLocationId: uuid("from_location_id")
      .notNull()
      .references(() => location.id),
    fromStorageAreaId: uuid("from_storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    toLocationId: uuid("to_location_id")
      .notNull()
      .references(() => location.id),
    toStorageAreaId: uuid("to_storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    status: text("status").notNull().default("draft"),
    dispatchedAt: tstz("dispatched_at"),
    receivedAt: tstz("received_at"),
    // The two ledger legs (DEC-029). Nullable until each leg is posted; the
    // unique ledger pair is read via `stock_movement.transfer_id`.
    dispatchMovementId: uuid("dispatch_movement_id").references(
      (): AnyPgColumn => stockMovement.id,
    ),
    receiptMovementId: uuid("receipt_movement_id").references((): AnyPgColumn => stockMovement.id),
    discrepancyNote: text("discrepancy_note"),
    ...auditColumns(),
  },
  (t) => [
    check("stock_transfer_status_check", enumCheck(t.status, TRANSFER_STATUS)),
    // A dispatched/received transfer has a dispatch timestamp; a received one
    // also has a receipt timestamp (and can only have been dispatched first).
    check(
      "stock_transfer_dispatched_check",
      sql`${t.status} not in ('dispatched', 'received') or ${t.dispatchedAt} is not null`,
    ),
    check(
      "stock_transfer_received_check",
      sql`${t.status} <> 'received' or (${t.dispatchedAt} is not null and ${t.receivedAt} is not null)`,
    ),
    index("stock_transfer_org_status_idx").on(t.organizationId, t.status),
    index("stock_transfer_from_location_idx").on(t.organizationId, t.fromLocationId),
    index("stock_transfer_to_location_idx").on(t.organizationId, t.toLocationId),
    index("stock_transfer_from_storage_area_idx").on(t.organizationId, t.fromStorageAreaId),
    index("stock_transfer_to_storage_area_idx").on(t.organizationId, t.toStorageAreaId),
    index("stock_transfer_dispatch_movement_idx").on(t.dispatchMovementId),
    index("stock_transfer_receipt_movement_idx").on(t.receiptMovementId),
  ],
);
