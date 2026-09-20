import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  breakEvenUnits as breakEvenUnitsFn,
  channelVariableCost as channelVariableCostFn,
  contributionMarginPct as contributionMarginPctFn,
  DomainError,
  parseDecimal,
  requiredNetPrice as requiredNetPriceFn,
  unitContribution as unitContributionFn,
  unitNetSales,
  type TaxBasis,
  type UnitNetSalesInput,
} from "@aquarela/domain";
import { COST_SELECTION_POLICY } from "@aquarela/persistence";

import type {
  NewPriceScenarioRecord,
  PriceScenarioRecord,
  PriceScenarioStore,
} from "./price-scenario-types";

/**
 * Audit action vocabulary for price scenarios (PRICE-001–005). Values are the
 * `audit_event.action` strings, defined here so this slice stays self-contained
 * until the barrel-wiring pass folds them into `actions.ts`.
 */
export const PRICE_SCENARIO_AUDIT_ACTIONS = {
  calculated: "costing.price_scenario.calculated",
  approved: "costing.price_scenario.approved",
} as const;

/**
 * Rounding method and scales recorded in every calculation snapshot (DEC-024):
 * HALF_UP with quantity 6 dp, money 4 dp and presented NOK 2 dp. Shared with the
 * cost-card snapshot so the two calculation paths cannot drift.
 */
export const SNAPSHOT_ROUNDING = {
  method: "HALF_UP",
  scales: { qty: 6, money: 4, presented: 2 },
} as const;

export interface PriceScenarioFeeInput {
  readonly percentageFeeRate: string;
  readonly feeBasisAmount: string;
  readonly fixedOrderFeePerUnit?: string;
}

export interface CalculatePriceScenarioInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productVariantId: string;
  readonly locationId?: string | null;
  readonly channelId?: string | null;
  readonly asOf: Date;
  readonly ruleVersion: string;
  readonly costSelectionPolicy: string;
  /** Exactly one of these drives the scenario net price; if both absent the scenario has no price yet. */
  readonly grossPrice?: string | null;
  readonly targetContributionRate?: string | null;
  readonly taxBasis: TaxBasis;
  readonly taxRate: string;
  readonly discount?: string;
  readonly refund?: string;
  readonly unitVariableCost: string;
  readonly channelFee?: PriceScenarioFeeInput | null;
  readonly fixedCost?: string | null;
  readonly volumeAssumption?: string | null;
}

export interface PriceScenarioOutcome {
  readonly grossPrice: string | null;
  readonly netPrice: string | null;
  readonly unitVariableCost: string;
  readonly channelVariableCost: string;
  readonly unitContribution: string | null;
  readonly contributionMarginPct: string | null;
  readonly requiredNetPrice: string | null;
  readonly breakEvenUnits: string | null;
}

export interface CalculatePriceScenarioResult {
  readonly priceScenarioId: string;
  readonly snapshotId: string;
  readonly outcome: PriceScenarioOutcome;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DomainError(`${field} must not be empty`);
  }
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainError(`${field} must be a valid Date`);
  }
}

function assertCostSelectionPolicy(value: string): void {
  if (!(COST_SELECTION_POLICY as readonly string[]).includes(value)) {
    throw new DomainError(`costSelectionPolicy must be one of ${COST_SELECTION_POLICY.join(", ")}`);
  }
}

/** The jsonb columns expect a plain object; the outcome is stored verbatim. */
function toJsonObject(value: object): Record<string, unknown> {
  return { ...value } as unknown as Record<string, unknown>;
}

function toFeeBreakdown(
  fee: PriceScenarioFeeInput | null | undefined,
  amount: string,
): Record<string, unknown> {
  if (fee === null || fee === undefined) {
    return {};
  }
  return {
    percentageFeeRate: fee.percentageFeeRate,
    feeBasisAmount: fee.feeBasisAmount,
    ...(fee.fixedOrderFeePerUnit !== undefined
      ? { fixedOrderFeePerUnit: fee.fixedOrderFeePerUnit }
      : {}),
    amount,
  };
}

/**
 * Calculates a price scenario (PRICE-001/004; `CALCULATION_CONTRACT` §8/§10) and
 * persists it as a `draft` with an immutable calculation snapshot and a
 * `calculated` audit row in one transaction. All money/rate maths is delegated
 * to `@aquarela/domain`; the application layer only validates inputs and
 * sequences the calls. Validation and the pure maths run before the transaction.
 *
 * NOTE: PRICE-002/003 (`PriceVersion` creation and "an unapproved price can
 * never become effective") is deliberately **not** implemented here — no
 * `price_version` table exists yet. This slice only produces the scenario and
 * the approval state.
 */
export async function calculatePriceScenario(
  store: PriceScenarioStore,
  input: CalculatePriceScenarioInput,
): Promise<CalculatePriceScenarioResult> {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.actorId, "actorId");
  assertNonEmpty(input.productVariantId, "productVariantId");
  assertNonEmpty(input.ruleVersion, "ruleVersion");
  assertValidDate(input.asOf, "asOf");
  assertCostSelectionPolicy(input.costSelectionPolicy);
  if (parseDecimal(input.unitVariableCost, MONEY_SCALE) < 0n) {
    throw new DomainError("unitVariableCost must not be negative");
  }
  // Validate every optional amount even when a later step skips it (break-even
  // is skipped for a non-positive contribution), so a malformed input never
  // reaches a driver or a domain call with a confusing error.
  if (input.fixedCost != null) {
    if (parseDecimal(input.fixedCost, MONEY_SCALE) < 0n) {
      throw new DomainError("fixedCost must not be negative");
    }
  }
  if (input.volumeAssumption != null) {
    if (parseDecimal(input.volumeAssumption, QUANTITY_SCALE) < 0n) {
      throw new DomainError("volumeAssumption must not be negative");
    }
  }
  if (input.grossPrice != null) {
    parseDecimal(input.grossPrice, MONEY_SCALE);
  }
  if (input.discount != null) {
    parseDecimal(input.discount, MONEY_SCALE);
  }
  if (input.refund != null) {
    parseDecimal(input.refund, MONEY_SCALE);
  }

  const netPrice =
    input.grossPrice != null
      ? unitNetSales({
          grossSales: input.grossPrice,
          taxBasis: input.taxBasis,
          taxRate: input.taxRate,
          ...(input.discount !== undefined ? { discount: input.discount } : {}),
          ...(input.refund !== undefined ? { refund: input.refund } : {}),
        } satisfies UnitNetSalesInput)
      : null;

  const channelFeeAmount = input.channelFee
    ? channelVariableCostFn({
        percentageFeeRate: input.channelFee.percentageFeeRate,
        feeBasisAmount: input.channelFee.feeBasisAmount,
        ...(input.channelFee.fixedOrderFeePerUnit !== undefined
          ? { fixedOrderFeePerUnit: input.channelFee.fixedOrderFeePerUnit }
          : {}),
      })
    : "0.0000";

  let unitContribution: string | null = null;
  let contributionMarginPct: string | null = null;
  if (netPrice !== null) {
    unitContribution = unitContributionFn(netPrice, input.unitVariableCost);
    contributionMarginPct = contributionMarginPctFn(netPrice, unitContribution);
  }
  const requiredNetPrice =
    input.targetContributionRate != null
      ? requiredNetPriceFn(input.unitVariableCost, input.targetContributionRate)
      : null;
  // `breakEvenUnits` throws by design on a non-positive contribution, so it is
  // only called once the contribution is known to be strictly positive.
  const breakEvenUnits =
    input.fixedCost != null &&
    unitContribution !== null &&
    parseDecimal(unitContribution, MONEY_SCALE) > 0n
      ? breakEvenUnitsFn(input.fixedCost, unitContribution)
      : null;

  const outcome: PriceScenarioOutcome = {
    grossPrice: input.grossPrice ?? null,
    netPrice,
    unitVariableCost: input.unitVariableCost,
    channelVariableCost: channelFeeAmount,
    unitContribution,
    contributionMarginPct,
    requiredNetPrice,
    breakEvenUnits,
  };

  return store.withTransaction(async (tx) => {
    const variant = await tx.findProductVariant(input.productVariantId);
    if (variant === undefined) {
      throw new DomainError("product variant not found");
    }
    if (variant.organizationId !== input.organizationId) {
      throw new DomainError("product variant belongs to another organization");
    }

    // Optional org-scoped references are resolved inside the transaction and
    // checked against the scenario's organization; the single-column FKs are
    // org-agnostic, so a foreign id would otherwise be accepted.
    if (input.locationId != null) {
      const location = await tx.findLocation(input.locationId);
      if (location === undefined) {
        throw new DomainError("location not found");
      }
      if (location.organizationId !== input.organizationId) {
        throw new DomainError("location belongs to another organization");
      }
    }
    if (input.channelId != null) {
      const channel = await tx.findChannel(input.channelId);
      if (channel === undefined) {
        throw new DomainError("channel not found");
      }
      if (channel.organizationId !== input.organizationId) {
        throw new DomainError("channel belongs to another organization");
      }
    }

    const scenarioInput: NewPriceScenarioRecord = {
      organizationId: input.organizationId,
      productVariantId: input.productVariantId,
      locationId: input.locationId ?? null,
      channelId: input.channelId ?? null,
      grossPrice: input.grossPrice ?? null,
      netPrice,
      targetContributionPct: input.targetContributionRate ?? null,
      volumeAssumption: input.volumeAssumption ?? null,
      feeBreakdown: toFeeBreakdown(input.channelFee, channelFeeAmount),
      outcome: toJsonObject(outcome),
      state: "draft",
    };
    const scenario = await tx.createPriceScenario(scenarioInput);

    const snapshot = await tx.createCalculationSnapshot({
      organizationId: input.organizationId,
      costCardId: null,
      priceScenarioId: scenario.id,
      costSelectionPolicy: input.costSelectionPolicy,
      asOf: input.asOf,
      ruleVersion: input.ruleVersion,
      roundingMethod: SNAPSHOT_ROUNDING.method,
      roundingScales: SNAPSHOT_ROUNDING.scales,
      totals: toJsonObject(outcome),
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRICE_SCENARIO_AUDIT_ACTIONS.calculated,
      entityType: "price_scenario",
      entityId: scenario.id,
      after: { state: "draft", net_price: netPrice, gross_price: input.grossPrice ?? null },
    });

    return { priceScenarioId: scenario.id, snapshotId: snapshot.id, outcome };
  });
}

export interface ApprovePriceScenarioInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly priceScenarioId: string;
}

export interface ApprovePriceScenarioResult {
  readonly priceScenarioId: string;
  readonly state: "approved";
}

/**
 * Approves a price scenario (PRICE-005). Only a `draft` or `submitted` scenario
 * can be approved; the state change and its audit row share one transaction.
 * `PriceVersion` creation/effectiveness (PRICE-002/003) is out of scope until a
 * `price_version` table exists.
 */
export async function approvePriceScenario(
  store: PriceScenarioStore,
  input: ApprovePriceScenarioInput,
): Promise<ApprovePriceScenarioResult> {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.actorId, "actorId");
  assertNonEmpty(input.priceScenarioId, "priceScenarioId");

  return store.withTransaction(async (tx) => {
    const scenario: PriceScenarioRecord | undefined = await tx.findPriceScenario(
      input.priceScenarioId,
    );
    if (scenario === undefined) {
      throw new DomainError("price scenario not found");
    }
    if (scenario.organizationId !== input.organizationId) {
      throw new DomainError("price scenario belongs to another organization");
    }
    if (scenario.state !== "draft" && scenario.state !== "submitted") {
      throw new DomainError(`price scenario cannot be approved from state ${scenario.state}`);
    }

    const updated = await tx.updatePriceScenario(input.priceScenarioId, { state: "approved" });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRICE_SCENARIO_AUDIT_ACTIONS.approved,
      entityType: "price_scenario",
      entityId: updated.id,
      before: { state: scenario.state },
      after: { state: updated.state },
    });

    return { priceScenarioId: updated.id, state: "approved" };
  });
}
