import {
  applyProductiveHoursPct,
  directLaborCost,
  DomainError,
  labourCostViews,
} from "@aquarela/domain";

import type { CostingStore } from "./types";

export interface ComputeLabourCostInput {
  readonly organizationId: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  readonly asOf: Date;
  readonly productiveMinutes: string;
  /** DEC-048: owner production minutes, imputed at the same role's loaded rate. */
  readonly imputedOwnerMinutes?: string;
}

export interface ComputeLabourCostResult {
  readonly loadedHourlyRate: string;
  readonly effectiveLoadedHourlyRate: string;
  readonly directLaborCost: string;
  /** `0.0000` when no owner minutes are passed. */
  readonly imputedOwnerLabor: string;
  readonly economicView: string;
  readonly cashView: string;
}

/**
 * Computes the direct labour cost for a role at an as-of date (COST-004/006/013,
 * CALCULATION_CONTRACT §7, DEC-048).
 *
 * Policy (DEC-055): a **null `productive_hours_pct` means 100% productive**, so
 * the loaded per-paid-hour rate is also the per-productive-hour rate and no
 * adjustment is applied (the I8 productive-hours remainder is still missing). A
 * non-null share divides the loaded rate up to a per-productive-hour rate via
 * `applyProductiveHoursPct`; both paid direct labour and imputed owner labour are
 * then valued at that **same effective per-productive-hour rate**, so the owner's
 * productive minutes are not double-benefited (and not double-charged) relative
 * to paid labour.
 *
 * The owner's imputed production minutes are valued at the same role's loaded
 * rate (DEC-048) and reported in the economic view only; the cash/statutory view
 * excludes them because the P&L shows no salary.
 */
export async function computeLabourCost(
  store: CostingStore,
  input: ComputeLabourCostInput,
): Promise<ComputeLabourCostResult> {
  const rate = await store.findEffectiveLaborRate({
    organizationId: input.organizationId,
    costCenterId: input.costCenterId,
    roleCode: input.roleCode,
    asOf: input.asOf,
  });
  if (rate === undefined) {
    throw new DomainError("no labour rate effective for the role at the requested date");
  }

  const effectiveLoadedHourlyRate =
    rate.productiveHoursPct === null
      ? rate.loadedHourlyRate
      : applyProductiveHoursPct(rate.loadedHourlyRate, rate.productiveHoursPct);

  const direct = directLaborCost(input.productiveMinutes, effectiveLoadedHourlyRate);
  const imputedOwnerLabor =
    input.imputedOwnerMinutes === undefined
      ? "0.0000"
      : directLaborCost(input.imputedOwnerMinutes, effectiveLoadedHourlyRate);
  const views = labourCostViews({ paidDirectLabor: direct, imputedOwnerLabor });

  return {
    loadedHourlyRate: rate.loadedHourlyRate,
    effectiveLoadedHourlyRate,
    directLaborCost: direct,
    imputedOwnerLabor,
    economicView: views.economicView,
    cashView: views.cashView,
  };
}
