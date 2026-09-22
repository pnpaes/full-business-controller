import type { AdjustmentPeriodRecord, AdjustmentPeriodStore } from "./types";

export interface FindAdjustmentPeriodQuery {
  readonly organizationId: string;
  readonly adjustmentPeriodId: string;
}

/**
 * One adjustment period by id, organization-scoped (`DEC-061`), or `undefined`.
 * A missing id and another tenant's id are indistinguishable, so a caller cannot
 * probe for the existence of an adjustment period outside its organization.
 */
export async function findAdjustmentPeriod(
  store: AdjustmentPeriodStore,
  query: FindAdjustmentPeriodQuery,
): Promise<AdjustmentPeriodRecord | undefined> {
  return store.findAdjustmentPeriod({
    organizationId: query.organizationId,
    id: query.adjustmentPeriodId,
  });
}
