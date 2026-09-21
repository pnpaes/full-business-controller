import {
  applyStockMovement,
  DomainError,
  parseDecimal,
  revaluationGap,
  STOCK_QUANTITY_SCALE,
  STOCK_VALUE_SCALE,
  type StockBalanceSnapshot,
} from "@aquarela/domain";
import { MOVEMENT_SOURCE_TYPE, STOCK_MOVEMENT_TYPE } from "@aquarela/persistence";

import { assertOptionalIsoDate } from "../costing/validation";
import { INVENTORY_AUDIT_ACTIONS } from "./actions";
import { resolveNegativeOverride } from "./permissions";
import { postRevaluationCorrection } from "./revaluation";
import type { InventoryStore, StockBalanceKey, StockMovementRecord } from "./types";
import { assertIsoInstant, isBlank } from "./validation";

const MOVEMENT_TYPES: readonly string[] = STOCK_MOVEMENT_TYPE;
const SOURCE_TYPES: readonly string[] = MOVEMENT_SOURCE_TYPE;

/**
 * Movement types whose `reason_code` is mandatory (DATA_DICTIONARY §6 "required
 * for adjustments/waste"). `revaluation` is included because a value-only
 * correction without a reason is unauditable (DEC-028).
 */
const REASON_REQUIRED_TYPES: readonly string[] = [
  "waste",
  "count_adjustment",
  "correction",
  "revaluation",
];

/**
 * The transaction-immutable reference reads a single posting needs. A batch
 * shares one instance across its lines, so a repeated item/location/storage
 * area/unit/lot is loaded once per distinct id instead of once per line (Fix 5).
 * `findOrCreateStockLot` is deliberately absent: it writes, so it stays per line.
 */
type ReferenceLookups = Pick<
  InventoryStore,
  "findOrganization" | "findItem" | "findLocation" | "findStorageArea" | "findUnit" | "findStockLot"
>;

/** Memoises a per-id lookup for the life of one transaction. */
function memoize<T>(
  load: (id: string) => Promise<T | undefined>,
): (id: string) => Promise<T | undefined> {
  const cache = new Map<string, Promise<T | undefined>>();
  return (id) => {
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const pending = load(id);
    cache.set(id, pending);
    return pending;
  };
}

function createReferenceLookups(store: InventoryStore): ReferenceLookups {
  return {
    findOrganization: memoize((id) => store.findOrganization(id)),
    findItem: memoize((id) => store.findItem(id)),
    findLocation: memoize((id) => store.findLocation(id)),
    findStorageArea: memoize((id) => store.findStorageArea(id)),
    findUnit: memoize((id) => store.findUnit(id)),
    findStockLot: memoize((id) => store.findStockLot(id)),
  };
}

function balanceKeyOf(movement: StockMovementRecord): StockBalanceKey {
  return {
    organizationId: movement.organizationId,
    itemId: movement.itemId,
    locationId: movement.locationId,
    storageAreaId: movement.storageAreaId,
    lotId: movement.lotId,
  };
}

export interface StockMovementLotInput {
  readonly lotNumber: string;
  readonly expiryDate?: string | null;
  readonly openedDate?: string | null;
  readonly receivedAt?: string | null;
}

export interface PostStockMovementInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly movementType: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** numeric(19,6), signed, non-zero. */
  readonly quantityDelta: string;
  /** numeric(19,4); required and non-negative for an inbound delta. */
  readonly unitCost?: string | null;
  /** ISO timestamp; the economic/booking date. */
  readonly occurredAt: string;
  readonly lotId?: string | null;
  readonly lot?: StockMovementLotInput | null;
  readonly reasonCode?: string | null;
  readonly idempotencyKey?: string | null;
  readonly allowNegativeOverride?: boolean;
}

export interface PostStockMovementResult {
  readonly movementId: string;
  readonly quantityOnHand: string;
  readonly valueOnHand: string;
  readonly avgUnitCost: string | null;
  readonly replayed: boolean;
  readonly negativeOverride: boolean;
}

export interface PostStockMovementsInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey?: string | null;
  readonly movements: readonly {
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly itemId: string;
    readonly movementType: string;
    readonly quantityDelta: string;
    readonly unitCost?: string | null;
    readonly lotId?: string | null;
    readonly lot?: StockMovementLotInput | null;
    readonly reasonCode?: string | null;
  }[];
  readonly allowNegativeOverride?: boolean;
}

/**
 * Validates the vocabulary, the signed quantity, the timestamp and the reason
 * rules before any transaction opens (cheap, deterministic, no I/O), then posts
 * one movement to the append-only ledger and updates the `stock_balance`
 * projection inside a single transaction (ADR-0005, INV-001, DEC-034).
 *
 * Idempotency is checked first inside the transaction: a replay of a known
 * `idempotencyKey` returns the stored movement and the current balance without
 * posting again. `lockStockBalance` is the per-key serialisation point; the
 * negative guard is DEC-010's block, and `allowNegativeOverride` is the
 * restricted emergency path.
 */
export async function postStockMovement(
  store: InventoryStore,
  input: PostStockMovementInput,
): Promise<PostStockMovementResult> {
  // A user-supplied key must not contain ':': the generated revaluation key
  // appends `:revaluation`, so `a:b` could collide with the suffix-holder `a`.
  // Batch-derived `key:<index>` keys bypass this at the internal boundary.
  if (input.idempotencyKey != null && input.idempotencyKey.includes(":")) {
    throw new DomainError("idempotencyKey must not contain ':'");
  }
  return postStockMovementInternal(store, input);
}

async function postStockMovementInternal(
  store: InventoryStore,
  input: PostStockMovementInput,
  references?: ReferenceLookups,
): Promise<PostStockMovementResult> {
  if (!MOVEMENT_TYPES.includes(input.movementType)) {
    throw new DomainError(`movementType must be one of ${MOVEMENT_TYPES.join(", ")}`);
  }
  if (!SOURCE_TYPES.includes(input.sourceType)) {
    throw new DomainError(`sourceType must be one of ${SOURCE_TYPES.join(", ")}`);
  }
  const quantityDelta = parseDecimal(input.quantityDelta, STOCK_QUANTITY_SCALE);
  if (quantityDelta === 0n) {
    throw new DomainError("quantityDelta must not be zero");
  }
  assertIsoInstant(input.occurredAt, "occurredAt");
  if (input.lotId !== undefined && input.lotId !== null && input.lot != null) {
    throw new DomainError("lotId and lot must not both be supplied");
  }
  if (input.lot !== undefined && input.lot !== null) {
    assertOptionalIsoDate(input.lot.expiryDate, "expiryDate");
    assertOptionalIsoDate(input.lot.openedDate, "openedDate");
  }
  if (REASON_REQUIRED_TYPES.includes(input.movementType) && isBlank(input.reasonCode)) {
    throw new DomainError(`reasonCode is required for ${input.movementType} movements`);
  }
  if (input.allowNegativeOverride === true && isBlank(input.reasonCode)) {
    throw new DomainError("allowNegativeOverride requires a reasonCode");
  }

  const unitCost = input.unitCost ?? null;
  if (quantityDelta > 0n) {
    if (unitCost === null) {
      throw new DomainError("inbound stock movement requires a unit cost");
    }
    if (parseDecimal(unitCost, STOCK_VALUE_SCALE) < 0n) {
      throw new DomainError("inbound stock movement unit cost must not be negative");
    }
  }

  const idempotencyKey = input.idempotencyKey ?? null;

  return store.withTransaction(async (tx) => {
    const lookups = references ?? createReferenceLookups(tx);
    if (idempotencyKey !== null) {
      const existing = await tx.findStockMovementByIdempotencyKey(
        input.organizationId,
        idempotencyKey,
      );
      if (existing !== undefined) {
        const balance = await tx.findStockBalance(balanceKeyOf(existing));
        // A replay never re-derives the override flag: the original posting's
        // audit fact already recorded it.
        return {
          movementId: existing.id,
          quantityOnHand: balance?.quantityOnHand ?? "0.000000",
          valueOnHand: balance?.valueOnHand ?? "0.0000",
          avgUnitCost: balance?.avgUnitCost ?? null,
          replayed: true,
          negativeOverride: false,
        };
      }
    }

    const organization = await lookups.findOrganization(input.organizationId);
    if (organization === undefined) {
      throw new DomainError("organization not found");
    }

    const item = await lookups.findItem(input.itemId);
    if (item === undefined || item.organizationId !== input.organizationId) {
      throw new DomainError("item not found in organization");
    }
    if (item.inventoryPolicy !== "stocked") {
      throw new DomainError("item does not hold stock");
    }

    const location = await lookups.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    const storageArea = await lookups.findStorageArea(input.storageAreaId);
    if (storageArea === undefined || storageArea.organizationId !== input.organizationId) {
      throw new DomainError("storage area not found in organization");
    }
    if (storageArea.locationId !== input.locationId) {
      throw new DomainError("storage area does not belong to the location");
    }

    const unit = await lookups.findUnit(item.baseUnitId);
    if (unit === undefined || unit.organizationId !== input.organizationId) {
      throw new DomainError("unit not found in organization");
    }

    // Lot resolution: an explicit `lotId` is loaded and org-checked; a `lot`
    // descriptor is create-or-find by `(item, location, lot_number)`.
    let lotId: string | null = input.lotId ?? null;
    if (input.lotId !== undefined && input.lotId !== null) {
      const lot = await lookups.findStockLot(input.lotId);
      if (lot === undefined || lot.organizationId !== input.organizationId) {
        throw new DomainError("lot not found in organization");
      }
      if (lot.itemId !== input.itemId) {
        throw new DomainError("lot does not belong to the item");
      }
      if (lot.locationId !== input.locationId) {
        throw new DomainError("lot does not belong to the location");
      }
    } else if (input.lot !== undefined && input.lot !== null) {
      const lot = await tx.findOrCreateStockLot({
        organizationId: input.organizationId,
        itemId: input.itemId,
        locationId: input.locationId,
        lotNumber: input.lot.lotNumber,
        expiryDate: input.lot.expiryDate ?? null,
        openedDate: input.lot.openedDate ?? null,
        receivedAt: input.lot.receivedAt ?? null,
        sourceMovementId: null,
      });
      lotId = lot.id;
    }

    if (item.lotTracked && lotId === null) {
      throw new DomainError("a lot-tracked item requires a lotId");
    }

    const occurredAt = new Date(input.occurredAt);
    const key: StockBalanceKey = {
      organizationId: input.organizationId,
      itemId: input.itemId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
      lotId,
    };

    const current = await tx.lockStockBalance(key, occurredAt);
    const balance: StockBalanceSnapshot = {
      quantityOnHand: current.quantityOnHand,
      valueOnHand: current.valueOnHand,
      avgUnitCost: current.avgUnitCost,
    };

    const negativeOverride = await resolveNegativeOverride(tx, {
      quantityOnHand: balance.quantityOnHand,
      quantityDelta: input.quantityDelta,
      allowNegativeOverride: input.allowNegativeOverride,
      actorId: input.actorId,
    });

    const posting = applyStockMovement(balance, { quantityDelta: input.quantityDelta, unitCost });
    const currency = organization.currency;
    // DEC-010's exception queue is not modelled yet, so a negative override that
    // actually leaves quantity below zero is flagged in the audit fact only.
    const requiresRevaluation =
      negativeOverride && parseDecimal(posting.quantityOnHand, STOCK_QUANTITY_SCALE) < 0n;

    const movement = await tx.createStockMovement({
      organizationId: input.organizationId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId,
      itemId: input.itemId,
      lotId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      unitId: item.baseUnitId,
      unitCost: posting.unitCostApplied,
      valueDelta: posting.valueDelta,
      currency,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reversalOfId: null,
      occurredAt: input.occurredAt,
      postedBy: input.actorId,
      reasonCode: input.reasonCode ?? null,
      idempotencyKey,
    });

    await tx.saveStockBalance(key, {
      quantityOnHand: posting.quantityOnHand,
      valueOnHand: posting.valueOnHand,
      avgUnitCost: posting.avgUnitCost,
      asOf: occurredAt,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: INVENTORY_AUDIT_ACTIONS.stockMovementPosted,
      entityType: "stock_movement",
      entityId: movement.id,
      after: {
        movement_type: input.movementType,
        quantity_delta: input.quantityDelta,
        value_delta: posting.valueDelta,
        unit_cost: posting.unitCostApplied,
        item_id: input.itemId,
        location_id: input.locationId,
        storage_area_id: input.storageAreaId,
        lot_id: lotId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        ...(negativeOverride ? { negative_override: true } : {}),
        ...(requiresRevaluation ? { requires_revaluation: true } : {}),
      },
    });

    // A normal posting can zero the quantity while leaving residual value when
    // the derived 4 dp average rounds (DEC-028): mirror the reversal path and
    // post an explicit value-only `revaluation` so the balance is clean at every
    // cutoff. The correction inherits the source and a default reason, and its
    // idempotency key is a distinct suffix of the input key.
    let finalBalance: StockBalanceSnapshot = posting;
    const gap = revaluationGap(posting);
    if (gap !== null) {
      finalBalance = (
        await postRevaluationCorrection(tx, {
          key,
          balance: posting,
          gap,
          reasonCode: input.reasonCode ?? "revaluation",
          sourceId: input.sourceId,
          occurredAt,
          actorId: input.actorId,
          currency,
          unitId: item.baseUnitId,
          lotId,
          reversalOfId: null,
          idempotencyKey: idempotencyKey === null ? null : `${idempotencyKey}:revaluation`,
        })
      ).balance;
    }

    return {
      movementId: movement.id,
      quantityOnHand: finalBalance.quantityOnHand,
      valueOnHand: finalBalance.valueOnHand,
      avgUnitCost: finalBalance.avgUnitCost,
      replayed: false,
      negativeOverride,
    };
  });
}

/**
 * Posts several movements as ONE atomic unit (PROD-002): the whole loop runs in
 * a single `withTransaction`, so a failure on any line rolls back every line.
 * The batch-wide `idempotencyKey`, when set, is suffixed with the line index so
 * each movement keeps the ledger's unique-key guarantee and a retry of the whole
 * batch replays rather than double-posts.
 */
export async function postStockMovements(
  store: InventoryStore,
  input: PostStockMovementsInput,
): Promise<PostStockMovementResult[]> {
  // Validate the batch-wide shape before any transaction opens (cheap and
  // deterministic), so a malformed batch fails without touching the ledger.
  if (input.movements.length === 0) {
    throw new DomainError("movements must not be empty");
  }
  if (!SOURCE_TYPES.includes(input.sourceType)) {
    throw new DomainError(`sourceType must be one of ${SOURCE_TYPES.join(", ")}`);
  }
  assertIsoInstant(input.occurredAt, "occurredAt");
  if (input.idempotencyKey != null && input.idempotencyKey.includes(":")) {
    throw new DomainError("idempotencyKey must not contain ':'");
  }

  return store.withTransaction(async (tx) => {
    const references = createReferenceLookups(tx);
    const results: PostStockMovementResult[] = [];
    for (const [index, movement] of input.movements.entries()) {
      results.push(
        await postStockMovementInternal(
          tx,
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            occurredAt: input.occurredAt,
            idempotencyKey:
              input.idempotencyKey === undefined || input.idempotencyKey === null
                ? null
                : `${input.idempotencyKey}:${index}`,
            ...(input.allowNegativeOverride === undefined
              ? {}
              : { allowNegativeOverride: input.allowNegativeOverride }),
            ...movement,
          },
          references,
        ),
      );
    }
    return results;
  });
}
