import {
  DomainError,
  STOCK_QUANTITY_SCALE,
  STOCK_VALUE_SCALE,
  applyStockMovement,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";
import { WASTE_STAGE } from "@aquarela/persistence";

import { postStockMovement } from "../inventory";
import type { InventoryItemRecord, StockBalanceKey } from "../inventory";
import { assertIsoInstant, isBlank } from "../inventory/validation";

import { WASTE_AUDIT_ACTIONS } from "./actions";
import type { NewWasteEventRecord, WasteEventRecord, WasteStore } from "./types";

const WASTE_STAGES: readonly string[] = WASTE_STAGE;

/**
 * Interim valuation capture: the ledger values the outbound at the locked moving
 * weighted average (ADR-0005), so the event records `moving_average`. Recorded,
 * not invented: `waste_event.value_method`/`value` can contradict the linked
 * movement (open point (a)).
 */
const WASTE_VALUE_METHOD = "moving_average";

export interface RecordWasteEventInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  /** Exactly one of `itemId` / `productVariantId` must be set. */
  readonly itemId?: string | null;
  readonly productVariantId?: string | null;
  /** Deferred plain uuid (`WASTE-002` batch link): no production batch yet. */
  readonly productionBatchId?: string | null;
  /** numeric(19,6) positive magnitude. */
  readonly quantity: string;
  readonly stage: string;
  readonly reasonCode: string;
  /** ISO timestamp; the economic/booking date. */
  readonly occurredAt: string;
  /** Free-text note; stored in `waste_event.corrective_action` (only free-text column). */
  readonly correctiveAction?: string | null;
  readonly photoFileId?: string | null;
  readonly snapshotId?: string | null;
  readonly allowNegativeOverride?: boolean;
  readonly idempotencyKey?: string | null;
}

export interface RecordWasteEventResult {
  readonly wasteEventId: string;
  readonly movementId: string;
  /** numeric(19,6). */
  readonly quantity: string;
  /** numeric(19,4). */
  readonly value: string;
  readonly valueMethod: string;
  readonly currency: string | null;
  readonly replayed: boolean;
}

function toResult(
  event: WasteEventRecord,
  movementId: string,
  replayed: boolean,
): RecordWasteEventResult {
  return {
    wasteEventId: event.id,
    movementId,
    quantity: event.quantity,
    value: event.value ?? "0.0000",
    valueMethod: event.valueMethod,
    currency: event.currency,
    replayed,
  };
}

/**
 * Resolves the stocked item a waste movement posts against: the item itself, or
 * a product variant's finished-good item. Cross-organization rows are rejected
 * here on top of the store's own scoping.
 */
async function resolveStockItem(
  store: WasteStore,
  organizationId: string,
  itemId: string | null,
  productVariantId: string | null,
): Promise<InventoryItemRecord> {
  if (itemId !== null) {
    const item = await store.findItem(itemId);
    if (item === undefined || item.organizationId !== organizationId) {
      throw new DomainError("item not found in organization");
    }
    if (item.inventoryPolicy !== "stocked") {
      throw new DomainError("item does not hold stock");
    }
    return item;
  }

  const variant =
    productVariantId === null ? undefined : await store.findProductVariant(productVariantId);
  if (variant === undefined || variant.organizationId !== organizationId) {
    throw new DomainError("product variant not found in organization");
  }
  if (variant.finishedGoodItemId === null) {
    throw new DomainError("product variant has no finished good item to move");
  }
  const item = await store.findItem(variant.finishedGoodItemId);
  if (item === undefined || item.organizationId !== organizationId) {
    throw new DomainError("finished good item not found in organization");
  }
  if (item.inventoryPolicy !== "stocked") {
    throw new DomainError("finished good item does not hold stock");
  }
  return item;
}

/**
 * Records one waste event (`WASTE-001`): validates the vocabulary/quantity/
 * reason, resolves the item or product variant (exactly one), posts the negative
 * `waste` movement to the append-only ledger through `postStockMovement`, and
 * persists the event — all in one transaction.
 *
 * Ordering note: migration `0020`'s `stock_movement_source_guard` requires a
 * `waste_event` with that id to exist before its `waste_event`-sourced movement
 * is inserted, so the event is written first. Its `value` is derived from the
 * *locked* balance with the same domain rule the movement writer uses
 * (`applyStockMovement`), so `event.value` equals the posted movement's
 * `|value_delta|` exactly; a residual-value `revaluation` correction the writer
 * may add is a separate movement and does not change this event's value.
 *
 * `reasonCode` is free text today; the DEC-018 stages double as the reasons and
 * the seed sets `reason_code = stage` (open point (b)). `productionBatchId` is
 * stored unvalidated (no batch table yet): `WASTE-002` (a waste linked to a
 * batch must not be counted again as yield loss) is recorded, not enforced.
 */
export async function recordWasteEvent(
  store: WasteStore,
  input: RecordWasteEventInput,
): Promise<RecordWasteEventResult> {
  const itemIdRaw = input.itemId ?? null;
  const variantIdRaw = input.productVariantId ?? null;
  const hasItem = itemIdRaw !== null && itemIdRaw.trim().length > 0;
  const hasVariant = variantIdRaw !== null && variantIdRaw.trim().length > 0;
  if (hasItem === hasVariant) {
    throw new DomainError("exactly one of itemId or productVariantId is required");
  }
  const itemId = hasItem && itemIdRaw !== null ? itemIdRaw.trim() : null;
  const productVariantId = hasVariant && variantIdRaw !== null ? variantIdRaw.trim() : null;

  if (!WASTE_STAGES.includes(input.stage)) {
    throw new DomainError(`stage must be one of ${WASTE_STAGES.join(", ")}`);
  }
  if (isBlank(input.reasonCode)) {
    throw new DomainError("reasonCode is required");
  }
  const quantity = parseDecimal(input.quantity, STOCK_QUANTITY_SCALE);
  if (quantity <= 0n) {
    throw new DomainError("quantity must be greater than zero");
  }
  assertIsoInstant(input.occurredAt, "occurredAt");
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && idempotencyKey.includes(":")) {
    throw new DomainError("idempotencyKey must not contain ':'");
  }

  return store.withTransaction(async (tx) => {
    // A replay of a known key returns the already-recorded event (the movement's
    // `source_id` is that event's id) instead of inserting a second event.
    if (idempotencyKey !== null) {
      const existing = await tx.findStockMovementByIdempotencyKey(
        input.organizationId,
        idempotencyKey,
      );
      if (existing !== undefined && existing.sourceType === "waste_event") {
        const replayed = await tx.findWasteEvent({
          organizationId: input.organizationId,
          wasteEventId: existing.sourceId,
        });
        if (replayed !== undefined) {
          return toResult(replayed, existing.id, true);
        }
      }
    }

    const organization = await tx.findOrganization(input.organizationId);
    if (organization === undefined) {
      throw new DomainError("organization not found");
    }

    const stockItem = await resolveStockItem(tx, input.organizationId, itemId, productVariantId);

    const unit = await tx.findUnit(stockItem.baseUnitId);
    if (unit === undefined || unit.organizationId !== input.organizationId) {
      throw new DomainError("unit not found in organization");
    }

    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    const storageArea = await tx.findStorageArea(input.storageAreaId);
    if (storageArea === undefined || storageArea.organizationId !== input.organizationId) {
      throw new DomainError("storage area not found in organization");
    }
    if (storageArea.locationId !== input.locationId) {
      throw new DomainError("storage area does not belong to the location");
    }

    const occurredAt = new Date(input.occurredAt);
    const quantityDelta = formatDecimal(-quantity, STOCK_QUANTITY_SCALE);
    const balanceKey: StockBalanceKey = {
      organizationId: input.organizationId,
      itemId: stockItem.id,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
      lotId: null,
    };

    // The trigger requires the event first; derive its value from the locked
    // balance with the movement writer's own domain rule.
    const current = await tx.lockStockBalance(balanceKey, occurredAt);
    const posting = applyStockMovement(
      {
        quantityOnHand: current.quantityOnHand,
        valueOnHand: current.valueOnHand,
        avgUnitCost: current.avgUnitCost,
      },
      { quantityDelta, unitCost: null },
    );
    const value = formatDecimal(
      -parseDecimal(posting.valueDelta, STOCK_VALUE_SCALE),
      STOCK_VALUE_SCALE,
    );

    const newEvent: NewWasteEventRecord = {
      organizationId: input.organizationId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
      itemId,
      productVariantId,
      productionBatchId: input.productionBatchId ?? null,
      quantity: formatDecimal(quantity, STOCK_QUANTITY_SCALE),
      unitId: stockItem.baseUnitId,
      stage: input.stage,
      reasonCode: input.reasonCode,
      valueMethod: WASTE_VALUE_METHOD,
      value,
      currency: organization.currency,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      photoFileId: input.photoFileId ?? null,
      correctiveAction: input.correctiveAction ?? null,
      snapshotId: input.snapshotId ?? null,
    };
    const event = await tx.createWasteEvent(newEvent);

    const movement = await postStockMovement(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
      itemId: stockItem.id,
      movementType: "waste",
      sourceType: "waste_event",
      sourceId: event.id,
      quantityDelta,
      unitCost: null,
      occurredAt: input.occurredAt,
      reasonCode: input.reasonCode,
      idempotencyKey,
      allowNegativeOverride: input.allowNegativeOverride ?? false,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: WASTE_AUDIT_ACTIONS.wasteEventRecorded,
      entityType: "waste_event",
      entityId: event.id,
      after: {
        stage: input.stage,
        reason_code: input.reasonCode,
        quantity: newEvent.quantity,
        unit_id: newEvent.unitId,
        value_method: newEvent.valueMethod,
        value: newEvent.value,
        currency: newEvent.currency,
        item_id: itemId,
        product_variant_id: productVariantId,
        location_id: input.locationId,
        storage_area_id: input.storageAreaId,
        movement_id: movement.movementId,
      },
    });

    return toResult(event, movement.movementId, false);
  });
}
