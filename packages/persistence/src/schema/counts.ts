import { boolean, check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { item } from "./catalog";
import {
  approvalCheck,
  auditColumns,
  enumCheck,
  jsonObject,
  orgId,
  quantity,
  tstz,
  uuidPk,
} from "./columns";
import { stockLot } from "./inventory";
import { location, organization, storageArea } from "./organization";
import { COUNT_STATUS } from "./vocabularies";

/**
 * `stock_count` (`DATA_DICTIONARY` §6, INV-004; DEC-017). The count is
 * risk-based/periodic and may be **blind** for controlled/high-value items.
 * There is deliberately no natural key: a count is an event, not a dated
 * master record, so re-running a count creates a new row (the count-line unique
 * key is the idempotency path, see `stockCountLine`).
 *
 * `scope` carries which items/areas the count covers; its jsonb shape is not
 * pinned down by any authority (recorded as an open point, see the slice-9
 * report — do not invent a schema for it).
 */
export const stockCount = pgTable(
  "stock_count",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    scope: jsonObject("scope"),
    blind: boolean("blind").notNull().default(false),
    cutoff: tstz("cutoff").notNull(),
    status: text("status").notNull().default("draft"),
    // FK app_user(id) is deferred like audit_event.actor_id (deferred-FK convention).
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    ...auditColumns(),
  },
  (t) => [
    check("stock_count_status_check", enumCheck(t.status, COUNT_STATUS)),
    // An approved count must record who approved it and when (DEC-017 approval).
    check("stock_count_approved_check", approvalCheck(t.status, t.approvedBy, t.approvedAt)),
    index("stock_count_org_location_cutoff_idx").on(t.organizationId, t.locationId, t.cutoff),
    index("stock_count_org_status_idx").on(t.organizationId, t.status),
  ],
);

/**
 * `stock_count_line` (`DATA_DICTIONARY` §6, INV-004). `expected_qty` is the
 * projected balance at the count cutoff; `counted_qty` is the blind/sighted
 * observation and stays null until counted; `variance_qty` is the derived
 * difference. A `recount` line re-declares the same
 * `(count, item, storage_area, lot)` key and replaces the prior observation
 * through `findOrCreateStockCountLine`.
 */
export const stockCountLine = pgTable(
  "stock_count_line",
  {
    id: uuidPk(),
    stockCountId: uuid("stock_count_id")
      .notNull()
      .references(() => stockCount.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    storageAreaId: uuid("storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    lotId: uuid("lot_id").references(() => stockLot.id),
    expectedQty: quantity("expected_qty").notNull(),
    countedQty: quantity("counted_qty"),
    varianceQty: quantity("variance_qty"),
    reasonCode: text("reason_code"),
    recount: boolean("recount").notNull().default(false),
  },
  (t) => [
    // `NULLS NOT DISTINCT` so the lot-less bucket is addressable by the key
    // (mirrors `stock_balance_key`).
    unique("stock_count_line_key")
      .on(t.stockCountId, t.itemId, t.storageAreaId, t.lotId)
      .nullsNotDistinct(),
    index("stock_count_line_count_idx").on(t.stockCountId),
    index("stock_count_line_item_idx").on(t.itemId),
    index("stock_count_line_storage_area_idx").on(t.storageAreaId),
    index("stock_count_line_lot_idx").on(t.lotId),
  ],
);
