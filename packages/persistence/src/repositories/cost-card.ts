import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client";
import { calculationSnapshot, costCard, snapshotComponent } from "../schema";

export type CostCard = typeof costCard.$inferSelect;
export type CalculationSnapshot = typeof calculationSnapshot.$inferSelect;
export type SnapshotComponent = typeof snapshotComponent.$inferSelect;

export interface NewCostCard {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId?: string | null;
  readonly recipeVersionId?: string | null;
  readonly costSelectionPolicy: string;
}

export async function createCostCard(db: Database, input: NewCostCard): Promise<CostCard> {
  const rows = await db.insert(costCard).values(input).returning();
  return rows[0]!;
}

export async function findCostCard(db: Database, id: string): Promise<CostCard | undefined> {
  const rows = await db.select().from(costCard).where(eq(costCard.id, id)).limit(1);
  return rows[0];
}

export interface ApprovedCostCardScopeQuery {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  /**
   * `null`/absent matches cards with no channel (an organization-wide price);
   * a channel id narrows to that channel. Mirrors the slice-6 convention where
   * a null filter value is meaningful, not "unfiltered".
   */
  readonly channelId?: string | null;
}

/**
 * The approved card for one exact scope, or an empty list. The partial unique
 * index `cost_card_approved_scope_key` (migration `0016`) guarantees at most one
 * `approved` card per `(organization, product variant, location, channel)`, so
 * this returns zero or one row and needs no ordering.
 */
export async function listApprovedCostCardsForScope(
  db: Database,
  query: ApprovedCostCardScopeQuery,
): Promise<readonly CostCard[]> {
  const channelFilter =
    query.channelId === undefined || query.channelId === null
      ? isNull(costCard.channelId)
      : eq(costCard.channelId, query.channelId);
  return db
    .select()
    .from(costCard)
    .where(
      and(
        eq(costCard.organizationId, query.organizationId),
        eq(costCard.productVariantId, query.productVariantId),
        eq(costCard.locationId, query.locationId),
        eq(costCard.state, "approved"),
        channelFilter,
      ),
    );
}

export interface CostCardPatch {
  readonly state?: string;
  readonly approvedBy?: string | null;
  readonly approvedAt?: Date | null;
  readonly snapshotId?: string | null;
}

export async function updateCostCard(
  db: Database,
  id: string,
  patch: CostCardPatch,
): Promise<CostCard> {
  const rows = await db.update(costCard).set(patch).where(eq(costCard.id, id)).returning();
  return rows[0]!;
}

export interface NewCalculationSnapshot {
  readonly organizationId: string;
  readonly costCardId?: string | null;
  readonly priceScenarioId?: string | null;
  readonly costSelectionPolicy: string;
  readonly asOf: Date;
  readonly taxRuleSnapshot?: Record<string, unknown>;
  readonly fxRateId?: string | null;
  readonly roundingMethod?: string;
  readonly roundingScales?: Record<string, unknown>;
  readonly ruleVersion: string;
  readonly totals: Record<string, unknown>;
}

export async function createCalculationSnapshot(
  db: Database,
  input: NewCalculationSnapshot,
): Promise<CalculationSnapshot> {
  const rows = await db.insert(calculationSnapshot).values(input).returning();
  return rows[0]!;
}

export async function findCalculationSnapshot(
  db: Database,
  id: string,
): Promise<CalculationSnapshot | undefined> {
  const rows = await db
    .select()
    .from(calculationSnapshot)
    .where(eq(calculationSnapshot.id, id))
    .limit(1);
  return rows[0];
}

export interface NewSnapshotComponent {
  readonly snapshotId: string;
  readonly componentKind: string;
  readonly itemId?: string | null;
  readonly quantity?: string | null;
  readonly unitId?: string | null;
  readonly unitCost?: string | null;
  readonly amount?: string | null;
  readonly roundingBoundary?: string | null;
  readonly provenance?: Record<string, unknown>;
}

/**
 * Insert-only in practice: `snapshot_component` stores the immutable
 * intermediates behind a snapshot, so there is deliberately no update/delete
 * helper here. An empty input issues no SQL.
 */
export async function createSnapshotComponents(
  db: Database,
  inputs: readonly NewSnapshotComponent[],
): Promise<readonly SnapshotComponent[]> {
  if (inputs.length === 0) return [];
  return db
    .insert(snapshotComponent)
    .values([...inputs])
    .returning();
}

export async function listSnapshotComponents(
  db: Database,
  snapshotId: string,
): Promise<readonly SnapshotComponent[]> {
  return db
    .select()
    .from(snapshotComponent)
    .where(eq(snapshotComponent.snapshotId, snapshotId))
    .orderBy(snapshotComponent.componentKind, snapshotComponent.id);
}
