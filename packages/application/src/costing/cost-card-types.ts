import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice-7 cost cards + calculation
 * snapshots + approval (COST-005/008/009, DEC-021/DEC-024). Like the slice-6
 * `CostingStore`, this is a narrow port over `@aquarela/persistence` so the
 * commands can be unit-tested against an in-memory fake; the real adapter is
 * `createPostgresCostCardStore`. The record types mirror the persistence rows
 * with `date`/`timestamptz` columns carried as ISO strings and the jsonb columns
 * carried as plain objects.
 */

export interface CostCardRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId: string | null;
  readonly recipeVersionId: string | null;
  readonly state: string;
  readonly costSelectionPolicy: string;
  readonly calculatedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly snapshotId: string | null;
}

export interface NewCostCardRecord {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId: string | null;
  readonly recipeVersionId: string | null;
  readonly costSelectionPolicy: string;
}

export interface CalculationSnapshotRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly costCardId: string | null;
  readonly priceScenarioId: string | null;
  readonly costSelectionPolicy: string;
  readonly asOf: string;
  readonly taxRuleSnapshot: Record<string, unknown>;
  readonly fxRateId: string | null;
  readonly roundingMethod: string;
  readonly roundingScales: Record<string, unknown>;
  readonly ruleVersion: string;
  readonly totals: Record<string, unknown>;
  readonly createdAt: string;
}

export interface NewCalculationSnapshotRecord {
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

export interface SnapshotComponentRecord {
  readonly id: string;
  readonly snapshotId: string;
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly quantity: string | null;
  readonly unitId: string | null;
  readonly unitCost: string | null;
  readonly amount: string | null;
  readonly roundingBoundary: string | null;
  readonly provenance: Record<string, unknown>;
}

export interface NewSnapshotComponentRecord {
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

export interface CostCardStore {
  /** Binds `fn` to one transaction so the cost card, snapshot and audit commit together. */
  withTransaction<T>(fn: (store: CostCardStore) => Promise<T>): Promise<T>;
  findProductVariant(
    productVariantId: string,
  ): Promise<{ id: string; organizationId: string } | undefined>;
  createCostCard(input: NewCostCardRecord): Promise<CostCardRecord>;
  findCostCard(costCardId: string): Promise<CostCardRecord | undefined>;
  listApprovedCostCardsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string;
    readonly channelId?: string | null;
  }): Promise<readonly CostCardRecord[]>;
  updateCostCard(
    costCardId: string,
    patch: {
      readonly state?: string;
      readonly approvedBy?: string | null;
      readonly approvedAt?: Date | null;
      readonly snapshotId?: string | null;
    },
  ): Promise<CostCardRecord>;
  createCalculationSnapshot(
    input: NewCalculationSnapshotRecord,
  ): Promise<CalculationSnapshotRecord>;
  createSnapshotComponents(
    inputs: readonly NewSnapshotComponentRecord[],
  ): Promise<readonly SnapshotComponentRecord[]>;
  listSnapshotComponents(snapshotId: string): Promise<readonly SnapshotComponentRecord[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
