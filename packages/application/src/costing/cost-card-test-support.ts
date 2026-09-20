import type { AuditInput } from "../auth";
import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  CostCardStore,
  NewCalculationSnapshotRecord,
  NewCostCardRecord,
  NewSnapshotComponentRecord,
  SnapshotComponentRecord,
} from "./cost-card-types";

/**
 * In-memory `CostCardStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise the commands without a database;
 * `cost-card.postgres.test.ts` covers the real adapter.
 */
export class FakeCostCardStore implements CostCardStore {
  readonly productVariants = new Map<string, { id: string; organizationId: string }>();
  readonly locations = new Map<string, { id: string; organizationId: string }>();
  readonly channels = new Map<string, { id: string; organizationId: string }>();
  readonly recipeVersions = new Map<string, { id: string; organizationId: string }>();
  readonly costCards = new Map<string, CostCardRecord>();
  readonly snapshots: CalculationSnapshotRecord[] = [];
  readonly snapshotComponents: SnapshotComponentRecord[] = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: CostCardStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findProductVariant(
    productVariantId: string,
  ): Promise<{ id: string; organizationId: string } | undefined> {
    return Promise.resolve(this.productVariants.get(productVariantId));
  }

  findLocation(locationId: string): Promise<{ id: string; organizationId: string } | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  findChannel(channelId: string): Promise<{ id: string; organizationId: string } | undefined> {
    return Promise.resolve(this.channels.get(channelId));
  }

  findRecipeVersion(
    recipeVersionId: string,
  ): Promise<{ id: string; organizationId: string } | undefined> {
    return Promise.resolve(this.recipeVersions.get(recipeVersionId));
  }

  createCostCard(input: NewCostCardRecord): Promise<CostCardRecord> {
    const record: CostCardRecord = {
      id: this.nextId("cost-card"),
      organizationId: input.organizationId,
      productVariantId: input.productVariantId,
      locationId: input.locationId,
      channelId: input.channelId,
      recipeVersionId: input.recipeVersionId,
      state: "draft",
      costSelectionPolicy: input.costSelectionPolicy,
      calculatedAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      snapshotId: null,
    };
    this.costCards.set(record.id, record);
    return Promise.resolve(record);
  }

  findCostCard(costCardId: string): Promise<CostCardRecord | undefined> {
    return Promise.resolve(this.costCards.get(costCardId));
  }

  listApprovedCostCardsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string;
    readonly channelId?: string | null;
  }): Promise<readonly CostCardRecord[]> {
    const matches = [...this.costCards.values()]
      .filter(
        (card) =>
          card.organizationId === query.organizationId &&
          card.productVariantId === query.productVariantId &&
          card.locationId === query.locationId &&
          card.state === "approved" &&
          (query.channelId === undefined || query.channelId === null
            ? card.channelId === null
            : card.channelId === query.channelId),
      )
      .sort((a, b) =>
        a.calculatedAt < b.calculatedAt ? 1 : a.calculatedAt > b.calculatedAt ? -1 : 0,
      );
    return Promise.resolve(matches);
  }

  async updateCostCard(
    costCardId: string,
    patch: {
      readonly state?: string;
      readonly approvedBy?: string | null;
      readonly approvedAt?: Date | null;
      readonly snapshotId?: string | null;
    },
  ): Promise<CostCardRecord> {
    const existing = this.costCards.get(costCardId);
    if (existing === undefined) {
      throw new Error("cost card not found");
    }
    const updated: CostCardRecord = {
      ...existing,
      ...(patch.state === undefined ? {} : { state: patch.state }),
      ...(patch.approvedBy === undefined ? {} : { approvedBy: patch.approvedBy }),
      ...(patch.approvedAt === undefined
        ? {}
        : { approvedAt: patch.approvedAt === null ? null : patch.approvedAt.toISOString() }),
      ...(patch.snapshotId === undefined ? {} : { snapshotId: patch.snapshotId }),
    };
    this.costCards.set(costCardId, updated);
    return updated;
  }

  createCalculationSnapshot(
    input: NewCalculationSnapshotRecord,
  ): Promise<CalculationSnapshotRecord> {
    const record: CalculationSnapshotRecord = {
      id: this.nextId("snapshot"),
      organizationId: input.organizationId,
      costCardId: input.costCardId ?? null,
      priceScenarioId: input.priceScenarioId ?? null,
      costSelectionPolicy: input.costSelectionPolicy,
      asOf: input.asOf.toISOString(),
      taxRuleSnapshot: input.taxRuleSnapshot ?? {},
      fxRateId: input.fxRateId ?? null,
      roundingMethod: input.roundingMethod ?? "HALF_UP",
      roundingScales: input.roundingScales ?? {},
      ruleVersion: input.ruleVersion,
      totals: input.totals,
      createdAt: new Date().toISOString(),
    };
    this.snapshots.push(record);
    return Promise.resolve(record);
  }

  createSnapshotComponents(
    inputs: readonly NewSnapshotComponentRecord[],
  ): Promise<readonly SnapshotComponentRecord[]> {
    const records = inputs.map((input) => {
      const record: SnapshotComponentRecord = {
        id: this.nextId("snapshot-component"),
        snapshotId: input.snapshotId,
        componentKind: input.componentKind,
        itemId: input.itemId ?? null,
        quantity: input.quantity ?? null,
        unitId: input.unitId ?? null,
        unitCost: input.unitCost ?? null,
        amount: input.amount ?? null,
        roundingBoundary: input.roundingBoundary ?? null,
        provenance: input.provenance ?? {},
      };
      this.snapshotComponents.push(record);
      return record;
    });
    return Promise.resolve(records);
  }

  listSnapshotComponents(snapshotId: string): Promise<readonly SnapshotComponentRecord[]> {
    return Promise.resolve(
      this.snapshotComponents.filter((component) => component.snapshotId === snapshotId),
    );
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
