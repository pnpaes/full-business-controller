import { DomainError, parseDecimal, QUANTITY_SCALE } from "@aquarela/domain";

import { CATALOG_AUDIT_ACTIONS } from "./actions";
import type { MasterDataStore } from "./types";

export interface RegisterUnitConversionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly fromUnitCode: string;
  readonly toUnitCode: string;
  /** numeric(19,6); 1 `from` = factor × `to`. */
  readonly factor: string;
  /** Defaults to now when absent. */
  readonly effectiveFrom?: Date;
  readonly effectiveTo?: Date | null;
}

export interface RegisterUnitConversionResult {
  readonly conversionId: string;
}

/**
 * Registers one org-wide (global) `unit_conversion` edge (FND-003): 1 `fromUnit`
 * = `factor` × `toUnit`, effective from `effectiveFrom`. Validated at this
 * boundary so an invalid row never reaches the database:
 *
 * - both units resolve in the organization (the repository lookups are scoped);
 * - the from and to units differ;
 * - the factor is a positive numeric(19,6);
 * - the effective window is `effectiveTo > effectiveFrom`;
 * - no conversion for the same unit pair is already effective at the start.
 *
 * Item-scoped (pack/density) conversions stay on the item detail screen; this
 * command writes the org-wide graph only. The `unit_conversion_*_no_overlap`
 * exclusion constraints remain the authority for overlapping windows under
 * concurrency; the Postgres adapter translates their violation into the same
 * domain failure.
 */
export async function registerUnitConversion(
  store: MasterDataStore,
  input: RegisterUnitConversionInput,
): Promise<RegisterUnitConversionResult> {
  const fromUnitCode = input.fromUnitCode.trim();
  const toUnitCode = input.toUnitCode.trim();
  if (fromUnitCode.length === 0 || toUnitCode.length === 0) {
    throw new DomainError("from and to unit codes must not be empty");
  }
  if (fromUnitCode === toUnitCode) {
    throw new DomainError("from and to units must differ");
  }
  const factor = input.factor.trim();
  if (parseDecimal(factor, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("conversion factor must be a positive quantity of at most 6 decimals");
  }
  const effectiveFrom = input.effectiveFrom ?? new Date();
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }

  return store.withTransaction(async (tx) => {
    const [fromUnit, toUnit] = await Promise.all([
      tx.findUnitByCode(input.organizationId, fromUnitCode),
      tx.findUnitByCode(input.organizationId, toUnitCode),
    ]);
    if (fromUnit === undefined) {
      throw new DomainError(`unit "${fromUnitCode}" not found`);
    }
    if (toUnit === undefined) {
      throw new DomainError(`unit "${toUnitCode}" not found`);
    }
    if (fromUnit.id === toUnit.id) {
      throw new DomainError("from and to units must differ");
    }

    const existing = await tx.listEffectiveConversions(input.organizationId, effectiveFrom, null);
    const duplicate = existing.some(
      (edge) =>
        edge.itemId === null && edge.fromUnit.id === fromUnit.id && edge.toUnit.id === toUnit.id,
    );
    if (duplicate) {
      throw new DomainError("a conversion for this unit pair is already effective");
    }

    const created = await tx.createUnitConversion({
      organizationId: input.organizationId,
      fromUnitId: fromUnit.id,
      toUnitId: toUnit.id,
      factor,
      itemId: null,
      effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: CATALOG_AUDIT_ACTIONS.unitConversionRegistered,
      entityType: "unit_conversion",
      entityId: created.id,
      after: {
        from_unit_code: fromUnitCode,
        to_unit_code: toUnitCode,
        factor,
        scope: "global",
        effective_from: effectiveFrom.toISOString(),
      },
    });

    return { conversionId: created.id };
  });
}
