import { computeLoadedHourlyRate, DomainError, parseDecimal } from "@aquarela/domain";
import { ROLE_CODE } from "@aquarela/persistence";

import { COSTING_AUDIT_ACTIONS } from "./actions";
import type { CostingStore } from "./types";
import { assertEffectiveRange } from "./validation";

const ROLE_CODES: readonly string[] = ROLE_CODE;

/** `labor_rate.productive_hours_pct` is `numeric(6,4)`. */
const PRODUCTIVE_HOURS_SCALE = 4;
const PRODUCTIVE_HOURS_ONE = 10n ** 4n;

export interface RegisterLaborRateInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  /** Base hourly wage; the statutory components are derived (LABOUR_ASSUMPTIONS §3). */
  readonly baseHourlyRate: string;
  readonly feriepengerPct?: string;
  readonly employerContributionPct?: string;
  readonly pensionPct?: string;
  /** `numeric(6,4)`, in `(0,1]`; null means 100% productive. */
  readonly productiveHoursPct?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface RegisterLaborRateResult {
  readonly laborRateId: string;
  /** The derived 2 dp loaded rate (`LOADED_RATE_SCALE`), as persisted. */
  readonly loadedHourlyRate: string;
}

/**
 * Registers one labour rate for a role in a cost centre, deriving the loaded
 * hourly rate from the base and the statutory percentages
 * (`computeLoadedHourlyRate`, LABOUR_ASSUMPTIONS §3, DEC-006). The cheap
 * validations (role vocabulary, effective window, productive-hours share, the
 * rate maths) all run before the transaction; only the cross-entity cost-centre
 * check and the insert need the store.
 */
export async function registerLaborRate(
  store: CostingStore,
  input: RegisterLaborRateInput,
): Promise<RegisterLaborRateResult> {
  if (!ROLE_CODES.includes(input.roleCode)) {
    throw new DomainError(`roleCode must be one of ${ROLE_CODES.join(", ")}`);
  }
  const effectiveTo = input.effectiveTo ?? null;
  assertEffectiveRange(input.effectiveFrom, effectiveTo);

  const productiveHoursPct = input.productiveHoursPct ?? null;
  if (productiveHoursPct !== null) {
    const pct = parseDecimal(productiveHoursPct, PRODUCTIVE_HOURS_SCALE);
    if (pct <= 0n || pct > PRODUCTIVE_HOURS_ONE) {
      throw new DomainError("productiveHoursPct must be in (0, 1]");
    }
  }

  const loadedHourlyRate = computeLoadedHourlyRate({
    baseHourlyRate: input.baseHourlyRate,
    ...(input.feriepengerPct === undefined ? {} : { feriepengerPct: input.feriepengerPct }),
    ...(input.employerContributionPct === undefined
      ? {}
      : { employerContributionPct: input.employerContributionPct }),
    ...(input.pensionPct === undefined ? {} : { pensionPct: input.pensionPct }),
  }).loadedHourlyRate;

  return store.withTransaction(async (tx) => {
    const costCenter = await tx.findCostCenter(input.costCenterId);
    if (costCenter === undefined || costCenter.organizationId !== input.organizationId) {
      throw new DomainError("cost center not found in organization");
    }

    const created = await tx.createLaborRate({
      organizationId: input.organizationId,
      costCenterId: input.costCenterId,
      roleCode: input.roleCode,
      loadedHourlyRate,
      productiveHoursPct,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COSTING_AUDIT_ACTIONS.laborRateRegistered,
      entityType: "labor_rate",
      entityId: created.id,
      after: {
        cost_center_id: input.costCenterId,
        role_code: input.roleCode,
        loaded_hourly_rate: loadedHourlyRate,
      },
    });

    return { laborRateId: created.id, loadedHourlyRate };
  });
}
