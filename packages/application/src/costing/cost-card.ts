import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  type CostCardCompositionInput,
  type CostCardTotals,
  computeCostCardTotals,
  DomainError,
  parseDecimal,
} from "@aquarela/domain";
import {
  COST_SELECTION_POLICY,
  ROUNDING_BOUNDARY,
  SNAPSHOT_COMPONENT_KIND,
} from "@aquarela/persistence";

import type { CostCardStore, NewSnapshotComponentRecord } from "./cost-card-types";
import { SNAPSHOT_ROUNDING } from "./price-scenario";

/** `audit_event.action` values for the cost-card lifecycle (COST-008/009). */
export const COST_CARD_AUDIT_ACTIONS = {
  calculated: "costing.cost_card.calculated",
  approved: "costing.cost_card.approved",
  superseded: "costing.cost_card.superseded",
} as const;

const COST_SELECTION_POLICIES: readonly string[] = COST_SELECTION_POLICY;
const SNAPSHOT_COMPONENT_KINDS: readonly string[] = SNAPSHOT_COMPONENT_KIND;
const ROUNDING_BOUNDARIES: readonly string[] = ROUNDING_BOUNDARY;

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DomainError(`${field} must not be empty`);
  }
}

export interface CostCardComponentInput {
  readonly componentKind: string;
  readonly itemId?: string | null;
  readonly quantity?: string | null;
  readonly unitId?: string | null;
  readonly unitCost?: string | null;
  readonly amount?: string | null;
  readonly roundingBoundary?: string | null;
  readonly provenance?: Record<string, unknown>;
}

export interface CalculateCostCardInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId?: string | null;
  readonly recipeVersionId?: string | null;
  readonly costSelectionPolicy: string;
  readonly asOf: Date;
  readonly ruleVersion: string;
  readonly composition: CostCardCompositionInput;
  readonly components?: readonly CostCardComponentInput[];
  readonly taxRuleSnapshot?: Record<string, unknown>;
  readonly fxRateId?: string | null;
  readonly roundingScales?: Record<string, unknown>;
}

export interface CalculateCostCardResult {
  readonly costCardId: string;
  readonly snapshotId: string;
  readonly totals: CostCardTotals;
}

/**
 * Calculates a cost card and freezes it as an immutable calculation snapshot
 * (COST-005/008, DEC-021/DEC-024; `CALCULATION_CONTRACT` §11). The totals come
 * from the domain primitive, which is the only place money is computed; every
 * cheap validation and the total itself run *before* the transaction so bad
 * input never opens one. The card is created first, then the snapshot, then the
 * card's `snapshot_id` is patched — the mutual `cost_card.snapshot_id` ↔
 * `calculation_snapshot.cost_card_id` FKs are deferrable, so this order is valid
 * inside one transaction and the card, snapshot, components and audit commit
 * together.
 */
export async function calculateCostCard(
  store: CostCardStore,
  input: CalculateCostCardInput,
): Promise<CalculateCostCardResult> {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.actorId, "actorId");
  assertNonEmpty(input.productVariantId, "productVariantId");
  assertNonEmpty(input.locationId, "locationId");
  if (!COST_SELECTION_POLICIES.includes(input.costSelectionPolicy)) {
    throw new DomainError(
      `costSelectionPolicy must be one of ${COST_SELECTION_POLICIES.join(", ")}`,
    );
  }
  if (!(input.asOf instanceof Date) || Number.isNaN(input.asOf.getTime())) {
    throw new DomainError("asOf must be a valid Date");
  }
  assertNonEmpty(input.ruleVersion, "ruleVersion");
  if (input.composition === undefined || input.composition === null) {
    throw new DomainError("composition is required");
  }
  for (const component of input.components ?? []) {
    if (!SNAPSHOT_COMPONENT_KINDS.includes(component.componentKind)) {
      throw new DomainError(`componentKind must be one of ${SNAPSHOT_COMPONENT_KINDS.join(", ")}`);
    }
    if (
      component.roundingBoundary !== undefined &&
      component.roundingBoundary !== null &&
      !ROUNDING_BOUNDARIES.includes(component.roundingBoundary)
    ) {
      throw new DomainError(`roundingBoundary must be one of ${ROUNDING_BOUNDARIES.join(", ")}`);
    }
    // Validate present decimal strings at the cheap stage so a malformed value
    // is a `DomainError`, not a leaked driver error from the insert.
    if (component.quantity != null) {
      parseDecimal(component.quantity, QUANTITY_SCALE);
    }
    if (component.unitCost != null) {
      parseDecimal(component.unitCost, MONEY_SCALE);
    }
    if (component.amount != null) {
      parseDecimal(component.amount, MONEY_SCALE);
    }
  }

  const totals = computeCostCardTotals(input.composition);

  return store.withTransaction(async (tx) => {
    const variant = await tx.findProductVariant(input.productVariantId);
    if (variant === undefined) {
      throw new DomainError("product variant not found");
    }
    if (variant.organizationId !== input.organizationId) {
      throw new DomainError("product variant belongs to another organization");
    }

    const costCard = await tx.createCostCard({
      organizationId: input.organizationId,
      productVariantId: input.productVariantId,
      locationId: input.locationId,
      channelId: input.channelId ?? null,
      recipeVersionId: input.recipeVersionId ?? null,
      costSelectionPolicy: input.costSelectionPolicy,
    });

    const snapshot = await tx.createCalculationSnapshot({
      organizationId: input.organizationId,
      costCardId: costCard.id,
      priceScenarioId: null,
      costSelectionPolicy: input.costSelectionPolicy,
      asOf: input.asOf,
      taxRuleSnapshot: input.taxRuleSnapshot ?? {},
      fxRateId: input.fxRateId ?? null,
      roundingMethod: SNAPSHOT_ROUNDING.method,
      roundingScales: input.roundingScales ?? SNAPSHOT_ROUNDING.scales,
      ruleVersion: input.ruleVersion,
      totals: { ...totals },
    });

    await tx.updateCostCard(costCard.id, { snapshotId: snapshot.id });

    const components: readonly NewSnapshotComponentRecord[] = (input.components ?? []).map(
      (component) => ({
        snapshotId: snapshot.id,
        componentKind: component.componentKind,
        itemId: component.itemId ?? null,
        quantity: component.quantity ?? null,
        unitId: component.unitId ?? null,
        unitCost: component.unitCost ?? null,
        amount: component.amount ?? null,
        roundingBoundary: component.roundingBoundary ?? null,
        provenance: component.provenance ?? {},
      }),
    );
    await tx.createSnapshotComponents(components);

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COST_CARD_AUDIT_ACTIONS.calculated,
      entityType: "cost_card",
      entityId: costCard.id,
      after: {
        snapshot_id: snapshot.id,
        state: "draft",
        cost_selection_policy: input.costSelectionPolicy,
      },
    });

    return { costCardId: costCard.id, snapshotId: snapshot.id, totals };
  });
}

export interface ApproveCostCardInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly costCardId: string;
  readonly approvedBy: string;
  readonly approvedAt?: Date;
}

export interface ApproveCostCardResult {
  readonly costCardId: string;
  readonly state: "approved";
  readonly supersededCostCardIds: readonly string[];
}

/**
 * Approves a calculated cost card and supersedes the prior approved card for the
 * exact scope (COST-009, DEC-021/DEC-024; `CALCULATION_CONTRACT` §11). Exactly
 * one approved card may exist per
 * `(organization, product variant, location, channel)`; every other approved
 * card in scope is flipped to `superseded` in the same transaction. A card with
 * no snapshot cannot be approved — approval pins a frozen calculation.
 */
export async function approveCostCard(
  store: CostCardStore,
  input: ApproveCostCardInput,
): Promise<ApproveCostCardResult> {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.actorId, "actorId");
  assertNonEmpty(input.costCardId, "costCardId");
  assertNonEmpty(input.approvedBy, "approvedBy");

  return store.withTransaction(async (tx) => {
    const card = await tx.findCostCard(input.costCardId);
    if (card === undefined) {
      throw new DomainError("cost card not found");
    }
    if (card.organizationId !== input.organizationId) {
      throw new DomainError("cost card belongs to another organization");
    }
    if (card.state === "approved") {
      throw new DomainError("cost card is already approved");
    }
    if (card.state === "superseded") {
      throw new DomainError("superseded cost card cannot be approved");
    }
    if (card.snapshotId === null) {
      throw new DomainError("cost card has no calculation snapshot to approve");
    }

    const approvedInScope = await tx.listApprovedCostCardsForScope({
      organizationId: card.organizationId,
      productVariantId: card.productVariantId,
      locationId: card.locationId,
      channelId: card.channelId,
    });

    const supersededCostCardIds: string[] = [];
    for (const existing of approvedInScope) {
      await tx.updateCostCard(existing.id, { state: "superseded" });
      supersededCostCardIds.push(existing.id);
      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: COST_CARD_AUDIT_ACTIONS.superseded,
        entityType: "cost_card",
        entityId: existing.id,
        before: { state: existing.state, snapshot_id: existing.snapshotId },
        after: { state: "superseded" },
      });
    }

    const approvedAt = input.approvedAt ?? new Date();
    await tx.updateCostCard(input.costCardId, {
      state: "approved",
      approvedBy: input.approvedBy,
      approvedAt,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COST_CARD_AUDIT_ACTIONS.approved,
      entityType: "cost_card",
      entityId: input.costCardId,
      before: { state: card.state, approved_by: card.approvedBy },
      after: { state: "approved", approved_by: input.approvedBy },
    });

    return { costCardId: input.costCardId, state: "approved", supersededCostCardIds };
  });
}
