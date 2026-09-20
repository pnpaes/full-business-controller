import { sql } from "drizzle-orm";
import { char, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import { auditColumns, enumCheck, money, orgId, quantity, tstz, uuidPk } from "./columns";
import { location, organization, storageArea } from "./organization";
import { productVariant } from "./products";
import { WASTE_STAGE, WASTE_VALUE_METHOD } from "./vocabularies";

/*
 * ponytail: slice-9 waste open points — recorded, deliberately NOT resolved.
 *
 * (c) `waste_event.value_method`/`value` are captured on the event, but the
 *     ledger's outbound `stock_movement.value_delta` for the linked waste
 *     movement is computed by the moving-weighted-average rule (ADR-0005).
 *     The two can therefore **contradict** each other: e.g. `value_method =
 *     'latest_price'` with a `value` that differs from the moving-average
 *     outbound value of the same quantity. No authority says which wins, how
 *     the difference is booked, or whether `value_method` must equal
 *     `moving_average` whenever a movement is linked. Recorded, not invented.
 *     The `snapshot_id` reference (a costing `calculation_snapshot`) is left a
 *     plain uuid for the same reason: the waste-valuation snapshot semantics
 *     are undecided.
 *
 * The nine `stage` values are the DEC-018 blame-free stages; `reason_code` is
 * free text today (the `adjustment_reason` vocabulary is for count
 * adjustments, not for waste stages).
 */
export const wasteEvent = pgTable(
  "waste_event",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    storageAreaId: uuid("storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    // Either an item or a produced variant identifies what was wasted.
    itemId: uuid("item_id").references(() => item.id),
    productVariantId: uuid("product_variant_id").references(() => productVariant.id),
    // FK production_batch(id) is deferred to the production slice.
    productionBatchId: uuid("production_batch_id"),
    quantity: quantity("quantity").notNull(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    stage: text("stage").notNull(),
    reasonCode: text("reason_code").notNull(),
    valueMethod: text("value_method").notNull(),
    value: money("value"),
    // Nullable and deliberately without the NOK default: an unvalued waste
    // event carries no currency until a `value` is recorded (open point (c)).
    currency: char("currency", { length: 3 }),
    occurredAt: tstz("occurred_at").notNull(),
    // FK app_user(id) is deferred like audit_event.actor_id (deferred-FK convention).
    actorId: uuid("actor_id").notNull(),
    // FK file_object(id) is deferred to the platform slice.
    photoFileId: uuid("photo_file_id"),
    correctiveAction: text("corrective_action"),
    // FK calculation_snapshot(id) deferred (open point (c): snapshot semantics).
    snapshotId: uuid("snapshot_id"),
    ...auditColumns(),
  },
  (t) => [
    check("waste_event_stage_check", enumCheck(t.stage, WASTE_STAGE)),
    check("waste_event_value_method_check", enumCheck(t.valueMethod, WASTE_VALUE_METHOD)),
    check(
      "waste_event_item_or_variant_check",
      sql`${t.itemId} is not null or ${t.productVariantId} is not null`,
    ),
    check("waste_event_quantity_check", sql`${t.quantity} > 0`),
    check("waste_event_value_check", sql`${t.value} is null or ${t.value} >= 0`),
    index("waste_event_org_location_occurred_idx").on(t.organizationId, t.locationId, t.occurredAt),
    index("waste_event_item_idx").on(t.itemId),
    index("waste_event_product_variant_idx").on(t.productVariantId),
    index("waste_event_storage_area_idx").on(t.storageAreaId),
  ],
);
