import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import { enumCheck, money, orgId, quantity, tstz, uuidPk } from "./columns";
import { location, organization, storageArea } from "./organization";
import { MOVEMENT_SOURCE_TYPE, STOCK_MOVEMENT_TYPE } from "./vocabularies";

export const stockLot = pgTable(
  "stock_lot",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    lotNumber: text("lot_number"),
    expiryDate: date("expiry_date"),
    openedDate: date("opened_date"),
    receivedAt: tstz("received_at"),
    // FK stock_movement when the receipt slice posts the originating movement.
    sourceMovementId: uuid("source_movement_id"),
  },
  (t) => [
    unique("stock_lot_item_id_location_id_lot_number_key").on(t.itemId, t.locationId, t.lotNumber),
  ],
);

export const stockMovement = pgTable(
  "stock_movement",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    storageAreaId: uuid("storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    lotId: uuid("lot_id").references(() => stockLot.id),
    movementType: text("movement_type").notNull(),
    quantityDelta: quantity("quantity_delta").notNull(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    unitCost: money("unit_cost"),
    valueDelta: money("value_delta"),
    currency: char("currency", { length: 3 }),
    sourceType: text("source_type").notNull(),
    // Polymorphic source; validated by trigger per slice (deferred tables).
    sourceId: uuid("source_id").notNull(),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => stockMovement.id),
    occurredAt: tstz("occurred_at").notNull(),
    postedAt: tstz("posted_at").notNull().defaultNow(),
    postedBy: uuid("posted_by").notNull(),
    reasonCode: text("reason_code"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    check("stock_movement_movement_type_check", enumCheck(t.movementType, STOCK_MOVEMENT_TYPE)),
    check("stock_movement_source_type_check", enumCheck(t.sourceType, MOVEMENT_SOURCE_TYPE)),
    check(
      "stock_movement_quantity_or_value_check",
      sql`${t.quantityDelta} <> 0 or coalesce(${t.valueDelta}, 0) <> 0`,
    ),
    check("stock_movement_unit_cost_check", sql`${t.unitCost} is null or ${t.unitCost} >= 0`),
    unique("stock_movement_idempotency_key_key").on(t.idempotencyKey),
    index("stock_movement_balance_idx").on(
      t.organizationId,
      t.itemId,
      t.locationId,
      t.storageAreaId,
      t.lotId,
      t.occurredAt,
      t.postedAt,
    ),
    index("stock_movement_source_idx").on(t.sourceType, t.sourceId),
    index("stock_movement_reversal_idx")
      .on(t.reversalOfId)
      .where(sql`${t.reversalOfId} is not null`),
    // Append-only enforcement (reject_posted_movement_change + row/truncate
    // triggers) is emitted in the raw `invariants` migration.
  ],
);

export const stockBalance = pgTable(
  "stock_balance",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    storageAreaId: uuid("storage_area_id")
      .notNull()
      .references(() => storageArea.id),
    lotId: uuid("lot_id").references(() => stockLot.id),
    quantityOnHand: quantity("quantity_on_hand").notNull().default("0"),
    valueOnHand: money("value_on_hand").notNull().default("0"),
    avgUnitCost: money("avg_unit_cost"),
    asOf: tstz("as_of").notNull(),
  },
  (t) => [
    unique("stock_balance_key")
      .on(t.itemId, t.locationId, t.storageAreaId, t.lotId)
      .nullsNotDistinct(),
  ],
);
