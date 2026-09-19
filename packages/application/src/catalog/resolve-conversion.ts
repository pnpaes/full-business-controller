import { ConversionGraph, DomainError, Unit, type UnitConversionEdge } from "@aquarela/domain";

import type { MasterDataStore, MasterUnit } from "./types";

export interface ResolveConversionInput {
  readonly organizationId: string;
  readonly fromUnitId: string;
  readonly toUnitId: string;
  readonly asOf: Date;
  /** `null`/absent resolves against global conversions only. */
  readonly itemId?: string | null;
}

export interface ResolvedConversion {
  readonly fromUnitId: string;
  readonly toUnitId: string;
  /** Factor at 6 dp; apply it with `convertQuantity` / `SupplierPack`. */
  readonly factor: string;
}

function toDomainUnit(unit: MasterUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

/**
 * Resolves the effective conversion factor between two units for an item at a
 * date (FND-003). The store returns the rows effective at `asOf` (global, plus
 * item-scoped when `itemId` is set); the domain graph then rejects ambiguity, an
 * inconsistent cycle, incompatible dimensions or a missing path instead of
 * guessing. The item-vs-global precedence is deliberately not decided here — a
 * conflicting pair is an error to be resolved by an owner decision.
 */
export async function resolveConversion(
  store: MasterDataStore,
  input: ResolveConversionInput,
): Promise<ResolvedConversion> {
  const [fromUnit, toUnit] = await Promise.all([
    store.findUnit(input.fromUnitId),
    store.findUnit(input.toUnitId),
  ]);
  if (fromUnit === undefined || toUnit === undefined) {
    throw new DomainError("conversion unit not found");
  }

  const rows = await store.listEffectiveConversions(
    input.organizationId,
    input.asOf,
    input.itemId ?? null,
  );
  const edges: UnitConversionEdge[] = rows.map((row) => ({
    from: toDomainUnit(row.fromUnit),
    to: toDomainUnit(row.toUnit),
    factor: row.factor,
    itemId: row.itemId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));

  const factor = ConversionGraph.from(edges).resolve(toDomainUnit(fromUnit), toDomainUnit(toUnit), {
    asOf: input.asOf,
    itemId: input.itemId ?? null,
  });
  return { fromUnitId: input.fromUnitId, toUnitId: input.toUnitId, factor };
}
