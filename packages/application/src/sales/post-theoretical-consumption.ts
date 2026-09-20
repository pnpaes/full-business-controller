import {
  DomainError,
  QUANTITY_SCALE,
  explodeTheoreticalConsumption,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { postStockMovements } from "../inventory";
import { assertIsoDate, isBlank } from "../imports/validation";

import { SALES_AUDIT_ACTIONS } from "./actions";
import type { ConsumptionStore } from "./types";

export interface PostTheoreticalConsumptionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** `yyyy-mm-dd`: the business day whose posted sales lines are consumed. */
  readonly occurredOn: string;
  /**
   * The storage area the components are drawn from. There is no WIP/source-draw
   * policy (the production slice records the same gap), so the caller supplies
   * it rather than a value being invented.
   */
  readonly storageAreaId: string;
  /** Optional base idempotency key; defaults to the `(location, date)` key. */
  readonly idempotencyKey?: string | null;
  readonly allowNegativeOverride?: boolean;
}

export interface PostTheoreticalConsumptionResult {
  readonly locationId: string;
  readonly occurredOn: string;
  readonly salesLineCount: number;
  readonly consumedLineCount: number;
  /** Variants with no effective recipe assignment: not consumption-bearing. */
  readonly skippedVariantIds: readonly string[];
  readonly movementIds: readonly string[];
  readonly replayed: boolean;
}

/**
 * Posts the day's **theoretical sale consumption** for one location (`DEC-009`,
 * `SALE-005`, ADR-0005): every posted sales line of the day is exploded to its
 * component consumption through `explodeTheoreticalConsumption` and posted as
 * negative `sale_consumption` movements at the moving weighted average
 * (`unitCost: null`).
 *
 * The whole day runs in one transaction, so either every line's batch commits or
 * none does. Each line's components are posted in **one atomic
 * `postStockMovements` batch** with `sourceType: "sales_line"` and `sourceId` =
 * that `sales_line` id — the grain migration `0023`'s
 * `stock_movement_source_guard` validates, and the reason the daily command
 * posts **per sales line** rather than as a single day/location batch. The
 * `DEC-009` daily-per-location grain versus a single `sales_line` `source_id` is
 * the recorded open point A1; the ledger guard is the constraint that decides
 * the interim shape, not a resolution of the ambiguity.
 *
 * Idempotency is per `(location, date)` plus line: the default key is
 * `sale-consumption.<locationId>.<date>.<salesLineId>`, so a retry of the day
 * replays each line's movements instead of double-posting.
 *
 * **WASTE-002:** expected trim/cooking loss lives in the recipe yield and is
 * never posted as a `waste` movement here; only an explicitly recorded abnormal
 * loss becomes a `waste_event`.
 *
 * A sold line whose variant has no effective recipe assignment (a retail pack,
 * or an unmapped SKU) is skipped and reported in `skippedVariantIds` rather than
 * failing the day: many sold products are not recipe-based. A recipe that exists
 * but cannot be exploded fails the whole transaction.
 */
export async function postTheoreticalConsumption(
  store: ConsumptionStore,
  input: PostTheoreticalConsumptionInput,
): Promise<PostTheoreticalConsumptionResult> {
  assertIsoDate(input.occurredOn, "occurredOn");
  if (isBlank(input.storageAreaId)) {
    throw new DomainError("storageAreaId is required");
  }
  const baseKey =
    input.idempotencyKey === undefined || input.idempotencyKey === null
      ? `sale-consumption.${input.locationId}.${input.occurredOn}`
      : input.idempotencyKey;
  if (baseKey.includes(":")) {
    throw new DomainError("idempotencyKey must not contain ':'");
  }

  const occurredAt = `${input.occurredOn}T00:00:00.000Z`;

  return store.withTransaction(async (tx) => {
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

    const salesLines = await tx.listSalesLinesForDay({
      organizationId: input.organizationId,
      locationId: input.locationId,
      date: input.occurredOn,
    });

    const skipped = new Set<string>();
    const movementIds: string[] = [];
    let consumedLineCount = 0;
    let replayedAny = false;
    let postedAny = false;

    for (const line of salesLines) {
      if (line.productVariantId === null) {
        continue;
      }
      const quantity = parseDecimal(line.quantity, QUANTITY_SCALE);
      if (quantity <= 0n) {
        continue;
      }
      const recipe = await tx.findVariantRecipe({
        organizationId: input.organizationId,
        productVariantId: line.productVariantId,
        locationId: input.locationId,
        asOf: new Date(occurredAt),
      });
      if (recipe === undefined) {
        skipped.add(line.productVariantId);
        continue;
      }

      const consumption = explodeTheoreticalConsumption({
        soldQuantity: line.quantity,
        usableYieldRate: recipe.usableYieldRate,
        components: recipe.components,
      }).filter((component) => parseDecimal(component.quantity, QUANTITY_SCALE) > 0n);
      if (consumption.length === 0) {
        continue;
      }

      const movements = consumption.map((component) => ({
        locationId: input.locationId,
        storageAreaId: input.storageAreaId,
        itemId: component.itemId,
        movementType: "sale_consumption",
        quantityDelta: formatDecimal(
          -parseDecimal(component.quantity, QUANTITY_SCALE),
          QUANTITY_SCALE,
        ),
        unitCost: null,
        lotId: null,
        reasonCode: null,
      }));

      const results = await postStockMovements(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        sourceType: "sales_line",
        sourceId: line.id,
        occurredAt,
        idempotencyKey: `${baseKey}.${line.id}`,
        movements,
        ...(input.allowNegativeOverride === undefined
          ? {}
          : { allowNegativeOverride: input.allowNegativeOverride }),
      });
      consumedLineCount += 1;
      for (const result of results) {
        movementIds.push(result.movementId);
        if (result.replayed) {
          replayedAny = true;
        } else {
          postedAny = true;
        }
      }
    }

    if (movementIds.length > 0) {
      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: SALES_AUDIT_ACTIONS.consumptionPosted,
        entityType: "location",
        entityId: input.locationId,
        after: {
          occurred_on: input.occurredOn,
          storage_area_id: input.storageAreaId,
          sales_line_count: salesLines.length,
          consumed_line_count: consumedLineCount,
          movement_count: movementIds.length,
          skipped_variant_ids: [...skipped],
        },
      });
    }

    return {
      locationId: input.locationId,
      occurredOn: input.occurredOn,
      salesLineCount: salesLines.length,
      consumedLineCount,
      skippedVariantIds: [...skipped].sort(),
      movementIds,
      replayed: replayedAny && !postedAny,
    };
  });
}
