import { applyProductiveHoursPct, unitDirectLaborCost } from "@aquarela/domain";

import type { LaborRateRecord } from "./types";

/**
 * `DEC-112` direct-labour resolver. `recipe_version.preparation_minutes` are the
 * direct-labour minutes **per batch** (the batch that yields
 * `approved_usable_output`); the batch minutes are valued at the effective
 * `labor_rate` for the version's `(costCentre, role)` and divided by the batch's
 * approved usable output in one B3 step (`unitDirectLaborCost`).
 *
 * The `DEC-055` productive-hours rule applies: a null `productive_hours_pct`
 * means 100 % productive, so the loaded per-paid-hour rate is already the
 * per-productive-hour rate; otherwise `applyProductiveHoursPct` scales it.
 *
 * Not resolved (`undefined`) when any of the three inputs is null or no labour
 * rate is effective — the caller keeps its explicit input.
 */
export interface ResolveDirectLaborCostInput {
  readonly organizationId: string;
  readonly asOf: Date;
  readonly preparationMinutes: number | null;
  readonly laborCostCenterId: string | null;
  readonly laborRoleCode: string | null;
  readonly approvedUsableOutput: string;
}

export interface ResolvedDirectLaborCost {
  readonly perUnitCost: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  readonly effectiveLoadedHourlyRate: string;
}

export async function resolveDirectLaborCost(
  store: {
    findEffectiveLaborRate(query: {
      readonly organizationId: string;
      readonly costCenterId: string;
      readonly roleCode: string;
      readonly asOf: Date;
    }): Promise<LaborRateRecord | undefined>;
  },
  input: ResolveDirectLaborCostInput,
): Promise<ResolvedDirectLaborCost | undefined> {
  if (
    input.preparationMinutes === null ||
    input.laborCostCenterId === null ||
    input.laborRoleCode === null
  ) {
    return undefined;
  }

  const rate = await store.findEffectiveLaborRate({
    organizationId: input.organizationId,
    costCenterId: input.laborCostCenterId,
    roleCode: input.laborRoleCode,
    asOf: input.asOf,
  });
  if (rate === undefined) {
    return undefined;
  }

  const effectiveLoadedHourlyRate =
    rate.productiveHoursPct === null
      ? rate.loadedHourlyRate
      : applyProductiveHoursPct(rate.loadedHourlyRate, rate.productiveHoursPct);

  return {
    perUnitCost: unitDirectLaborCost(
      String(input.preparationMinutes),
      effectiveLoadedHourlyRate,
      input.approvedUsableOutput,
    ),
    costCenterId: input.laborCostCenterId,
    roleCode: input.laborRoleCode,
    effectiveLoadedHourlyRate,
  };
}
