import type { AuditInput } from "../auth";
import type { ConversionEdge, MasterUnit } from "../catalog";
import { FakeCostingStore } from "../costing/test-support";
import {
  createFakeDataQualityException,
  type DataQualityExceptionRecord,
  type NewDataQualityExceptionRecord,
} from "../data-quality";
import type { StockBalanceRecord, StockLotRecord, StockMovementRecord } from "../inventory";
import { FakeInventoryStore, seedInventoryFixture } from "../inventory/test-support";
import type { InventoryFixture } from "../inventory/test-support";
import { FakeRecipeStore } from "../recipes/test-support";

import type {
  ListProductionBatchesQuery,
  ListProductionPlansQuery,
  NewProductionBatchInputRecord,
  NewProductionBatchOutputRecord,
  NewProductionBatchRecord,
  NewProductionPlanLineRecord,
  NewProductionPlanRecord,
  ProductionBatchCostStore,
  ProductionBatchInputRecord,
  ProductionBatchOutputRecord,
  ProductionBatchPatch,
  ProductionBatchRecord,
  ProductionPlanLineRecord,
  ProductionPlanRecord,
  ProductionRecipeLineRecord,
  ProductionRecipeRecord,
  ProductionRecipeVersionRecord,
  ProductionStore,
} from "./types";

const iso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

function cloneBatch(
  record: ProductionBatchRecord,
  patch: ProductionBatchPatch,
): ProductionBatchRecord {
  return {
    ...record,
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.actualStart === undefined ? {} : { actualStart: iso(patch.actualStart) }),
    ...(patch.actualFinish === undefined ? {} : { actualFinish: iso(patch.actualFinish) }),
    ...(patch.actualOutputQty === undefined ? {} : { actualOutputQty: patch.actualOutputQty }),
    ...(patch.yieldVariancePct === undefined ? {} : { yieldVariancePct: patch.yieldVariancePct }),
    ...(patch.actualLabourHours === undefined
      ? {}
      : { actualLabourHours: patch.actualLabourHours }),
    ...(patch.operatorId === undefined ? {} : { operatorId: patch.operatorId }),
    ...(patch.destinationStorageAreaId === undefined
      ? {}
      : { destinationStorageAreaId: patch.destinationStorageAreaId }),
  };
}

/**
 * A shallow copy of every mutable map/array a completion transaction can touch,
 * used to roll back a failed `withTransaction` (the base fake runs inline).
 */
interface ProductionSnapshot {
  readonly stockBalances: Map<string, StockBalanceRecord>;
  readonly stockMovements: Map<string, StockMovementRecord>;
  readonly stockLots: Map<string, StockLotRecord>;
  readonly audits: AuditInput[];
  readonly productionPlans: Map<string, ProductionPlanRecord>;
  readonly productionPlanLines: Map<string, ProductionPlanLineRecord>;
  readonly productionBatches: Map<string, ProductionBatchRecord>;
  readonly productionBatchInputs: ProductionBatchInputRecord[];
  readonly productionBatchOutputs: ProductionBatchOutputRecord[];
  readonly dataQualityExceptions: Map<string, DataQualityExceptionRecord>;
}

/**
 * In-memory `ProductionStore` for the unit suite: it extends
 * `FakeInventoryStore` so the completion command posts the ledger movements
 * through the same `postStockMovements` path the real adapter uses, and mirrors
 * the persistence repository's reader/writer contract (no batch-line update —
 * lines are appended at completion).
 */
export class FakeProductionStore extends FakeInventoryStore implements ProductionStore {
  readonly productionPlans = new Map<string, ProductionPlanRecord>();
  readonly productionPlanLines = new Map<string, ProductionPlanLineRecord>();
  readonly productionBatches = new Map<string, ProductionBatchRecord>();
  readonly productionBatchInputs: ProductionBatchInputRecord[] = [];
  readonly productionBatchOutputs: ProductionBatchOutputRecord[] = [];
  readonly recipes = new Map<string, ProductionRecipeRecord>();
  readonly recipeVersions = new Map<string, ProductionRecipeVersionRecord>();
  readonly recipeLines = new Map<string, ProductionRecipeLineRecord>();
  readonly masterUnits = new Map<string, MasterUnit>();
  readonly conversions: ConversionEdge[] = [];
  readonly dataQualityExceptions = new Map<string, DataQualityExceptionRecord>();

  private productionSequence = 0;

  private nextProductionId(prefix: string): string {
    this.productionSequence += 1;
    return `${prefix}-${this.productionSequence}`;
  }

  override async withTransaction<T>(fn: (store: ProductionStore) => Promise<T>): Promise<T> {
    // The base fake runs inline; this override adds rollback so the atomic
    // completion path can be tested (a failure mid-batch leaves no partial
    // movements, lines or header change behind).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): ProductionSnapshot {
    return {
      stockBalances: new Map(this.stockBalances),
      stockMovements: new Map(this.stockMovements),
      stockLots: new Map(this.stockLots),
      audits: [...this.audits],
      productionPlans: new Map(this.productionPlans),
      productionPlanLines: new Map(this.productionPlanLines),
      productionBatches: new Map(this.productionBatches),
      productionBatchInputs: [...this.productionBatchInputs],
      productionBatchOutputs: [...this.productionBatchOutputs],
      dataQualityExceptions: new Map(this.dataQualityExceptions),
    };
  }

  private restore(snapshot: ProductionSnapshot): void {
    this.stockBalances.clear();
    for (const [key, value] of snapshot.stockBalances) this.stockBalances.set(key, value);
    this.stockMovements.clear();
    for (const [key, value] of snapshot.stockMovements) this.stockMovements.set(key, value);
    this.stockLots.clear();
    for (const [key, value] of snapshot.stockLots) this.stockLots.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
    this.productionPlans.clear();
    for (const [key, value] of snapshot.productionPlans) this.productionPlans.set(key, value);
    this.productionPlanLines.clear();
    for (const [key, value] of snapshot.productionPlanLines)
      this.productionPlanLines.set(key, value);
    this.productionBatches.clear();
    for (const [key, value] of snapshot.productionBatches) this.productionBatches.set(key, value);
    this.productionBatchInputs.length = 0;
    this.productionBatchInputs.push(...snapshot.productionBatchInputs);
    this.productionBatchOutputs.length = 0;
    this.productionBatchOutputs.push(...snapshot.productionBatchOutputs);
    this.dataQualityExceptions.clear();
    for (const [key, value] of snapshot.dataQualityExceptions) {
      this.dataQualityExceptions.set(key, value);
    }
  }

  findMasterUnit(unitId: string): Promise<MasterUnit | undefined> {
    return Promise.resolve(this.masterUnits.get(unitId));
  }

  listEffectiveConversions(
    organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]> {
    void organizationId;
    const at = asOf.getTime();
    return Promise.resolve(
      this.conversions.filter(
        (edge) =>
          edge.effectiveFrom.getTime() <= at &&
          (edge.effectiveTo === null || at < edge.effectiveTo.getTime()) &&
          (edge.itemId === null || edge.itemId === itemId),
      ),
    );
  }

  findRecipe(recipeId: string): Promise<ProductionRecipeRecord | undefined> {
    return Promise.resolve(this.recipes.get(recipeId));
  }

  findRecipeVersion(recipeVersionId: string): Promise<ProductionRecipeVersionRecord | undefined> {
    return Promise.resolve(this.recipeVersions.get(recipeVersionId));
  }

  listRecipeLines(recipeVersionId: string): Promise<readonly ProductionRecipeLineRecord[]> {
    return Promise.resolve(
      [...this.recipeLines.values()].filter((line) => line.recipeVersionId === recipeVersionId),
    );
  }

  findProductionPlan(query: {
    readonly organizationId: string;
    readonly productionPlanId: string;
  }): Promise<ProductionPlanRecord | undefined> {
    const plan = this.productionPlans.get(query.productionPlanId);
    if (plan === undefined || plan.organizationId !== query.organizationId) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({ ...plan, lines: this.linesFor(plan.id) });
  }

  listProductionPlans(query: ListProductionPlansQuery): Promise<readonly ProductionPlanRecord[]> {
    let rows = [...this.productionPlans.values()]
      .filter((plan) => plan.organizationId === query.organizationId)
      .filter((plan) => query.locationId === undefined || plan.locationId === query.locationId)
      .filter((plan) => query.status === undefined || plan.status === query.status)
      .sort((a, b) => {
        if (a.productionDate !== b.productionDate) {
          return a.productionDate < b.productionDate ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
    if (query.offset !== undefined) {
      rows = rows.slice(query.offset);
    }
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return Promise.resolve(rows.map((plan) => ({ ...plan, lines: this.linesFor(plan.id) })));
  }

  private linesFor(planId: string): readonly ProductionPlanLineRecord[] {
    return [...this.productionPlanLines.values()]
      .filter((line) => line.planId === planId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt < b.createdAt ? -1 : 1;
        }
        return a.id < b.id ? -1 : 1;
      });
  }

  listProductionPlanLines(query: {
    readonly organizationId: string;
    readonly planIds: readonly string[];
  }): Promise<readonly ProductionPlanLineRecord[]> {
    const ids = new Set(query.planIds);
    return Promise.resolve(
      [...this.productionPlanLines.values()].filter(
        (line) => line.organizationId === query.organizationId && ids.has(line.planId),
      ),
    );
  }

  createProductionPlanLine(input: NewProductionPlanLineRecord): Promise<ProductionPlanLineRecord> {
    const record: ProductionPlanLineRecord = {
      id: this.nextProductionId("plan-line"),
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.productionPlanLines.set(record.id, record);
    return Promise.resolve(record);
  }

  findProductionPlanLine(query: {
    readonly organizationId: string;
    readonly planLineId: string;
  }): Promise<ProductionPlanLineRecord | undefined> {
    const line = this.productionPlanLines.get(query.planLineId);
    return Promise.resolve(
      line !== undefined && line.organizationId === query.organizationId ? line : undefined,
    );
  }

  createProductionPlan(input: NewProductionPlanRecord): Promise<ProductionPlanRecord> {
    const record: ProductionPlanRecord = {
      id: input.id ?? this.nextProductionId("plan"),
      organizationId: input.organizationId,
      locationId: input.locationId,
      productionDate: input.productionDate,
      status: input.status,
      lines: [],
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.productionPlans.set(record.id, record);
    return Promise.resolve(record);
  }

  findProductionBatch(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<ProductionBatchRecord | undefined> {
    const batch = this.productionBatches.get(query.productionBatchId);
    return Promise.resolve(
      batch !== undefined && batch.organizationId === query.organizationId ? batch : undefined,
    );
  }

  listProductionBatches(
    query: ListProductionBatchesQuery,
  ): Promise<readonly ProductionBatchRecord[]> {
    let rows = [...this.productionBatches.values()]
      .filter((batch) => batch.organizationId === query.organizationId)
      .filter((batch) => query.locationId === undefined || batch.locationId === query.locationId)
      .filter((batch) => query.status === undefined || batch.status === query.status)
      .filter((batch) => query.planId === undefined || batch.planId === query.planId)
      .filter((batch) => query.workstation === undefined || batch.workstation === query.workstation)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    if (query.offset !== undefined) {
      rows = rows.slice(query.offset);
    }
    if (query.limit !== undefined) {
      rows = rows.slice(0, query.limit);
    }
    return Promise.resolve(rows);
  }

  createProductionBatch(input: NewProductionBatchRecord): Promise<ProductionBatchRecord> {
    const record: ProductionBatchRecord = {
      id: input.id ?? this.nextProductionId("batch"),
      organizationId: input.organizationId,
      locationId: input.locationId,
      workstation: input.workstation,
      recipeVersionId: input.recipeVersionId,
      planId: input.planId,
      status: input.status,
      plannedStart: iso(input.plannedStart),
      actualStart: null,
      actualFinish: null,
      operatorId: input.operatorId,
      destinationStorageAreaId: input.destinationStorageAreaId,
      plannedQty: input.plannedQty,
      plannedOutputQty: input.plannedOutputQty,
      actualOutputQty: null,
      yieldVariancePct: null,
      actualLabourHours: null,
      reversalOfId: null,
      createdAt: new Date().toISOString(),
    };
    this.productionBatches.set(record.id, record);
    return Promise.resolve(record);
  }

  updateProductionBatch(
    id: string,
    patch: ProductionBatchPatch,
  ): Promise<ProductionBatchRecord | undefined> {
    const existing = this.productionBatches.get(id);
    if (existing === undefined) {
      return Promise.resolve(undefined);
    }
    const updated = cloneBatch(existing, patch);
    this.productionBatches.set(id, updated);
    return Promise.resolve(updated);
  }

  listProductionBatchInputs(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<readonly ProductionBatchInputRecord[]> {
    const batch = this.productionBatches.get(query.productionBatchId);
    if (batch === undefined || batch.organizationId !== query.organizationId) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.productionBatchInputs
        .filter((line) => line.productionBatchId === query.productionBatchId)
        .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
    );
  }

  createProductionBatchInput(
    input: NewProductionBatchInputRecord,
  ): Promise<ProductionBatchInputRecord> {
    const record: ProductionBatchInputRecord = {
      id: this.nextProductionId("batch-input"),
      ...input,
    };
    this.productionBatchInputs.push(record);
    return Promise.resolve(record);
  }

  listProductionBatchOutputs(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<readonly ProductionBatchOutputRecord[]> {
    const batch = this.productionBatches.get(query.productionBatchId);
    if (batch === undefined || batch.organizationId !== query.organizationId) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.productionBatchOutputs
        .filter((line) => line.productionBatchId === query.productionBatchId)
        .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
    );
  }

  createProductionBatchOutput(
    input: NewProductionBatchOutputRecord,
  ): Promise<ProductionBatchOutputRecord> {
    const record: ProductionBatchOutputRecord = {
      id: this.nextProductionId("batch-output"),
      ...input,
    };
    this.productionBatchOutputs.push(record);
    return Promise.resolve(record);
  }

  createDataQualityException(
    input: NewDataQualityExceptionRecord,
  ): Promise<DataQualityExceptionRecord> {
    return createFakeDataQualityException(this.dataQualityExceptions, input);
  }
}

export interface ProductionFixture extends InventoryFixture {
  readonly gramUnitId: string;
  readonly outputItemId: string;
  readonly recipeId: string;
  readonly recipeVersionId: string;
  readonly draftRecipeId: string;
  readonly draftRecipeVersionId: string;
}

/**
 * Seeds the inventory fixture plus the slice-10 vocabulary: a `g` unit, a
 * conversion `g → kg` (factor `0.001`), a stocked output item, an approved cake
 * recipe version (one ingredient line of 500 g) and a draft version for the
 * `PROD-001` approval guard. The inventory fixture's `itemId` is the flour input.
 */
export function seedProductionFixture(store: FakeProductionStore): ProductionFixture {
  const base = seedInventoryFixture(store);
  const effectiveFrom = new Date("2026-01-01T00:00:00.000Z");

  const gramUnitId = "unit-g";
  store.units.set(gramUnitId, {
    id: gramUnitId,
    organizationId: base.organizationId,
    code: "g",
    dimension: "mass",
  });
  store.masterUnits.set(base.unitId, {
    id: base.unitId,
    code: "kg",
    dimension: "mass",
    isBase: true,
  });
  store.masterUnits.set(gramUnitId, {
    id: gramUnitId,
    code: "g",
    dimension: "mass",
    isBase: false,
  });
  store.conversions.push({
    fromUnit: store.masterUnits.get(gramUnitId)!,
    toUnit: store.masterUnits.get(base.unitId)!,
    factor: "0.001",
    itemId: null,
    effectiveFrom,
    effectiveTo: null,
  });

  const outputItemId = "item-output";
  store.items.set(outputItemId, {
    id: outputItemId,
    organizationId: base.organizationId,
    code: "CAKE",
    name: "Finished cake",
    baseUnitId: base.unitId,
    inventoryPolicy: "stocked",
    lotTracked: false,
  });

  const recipeId = "recipe-cake";
  store.recipes.set(recipeId, {
    id: recipeId,
    organizationId: base.organizationId,
    code: "CAKE",
    name: "Cake",
    outputItemId,
  });
  const recipeVersionId = "rv-approved";
  store.recipeVersions.set(recipeVersionId, {
    id: recipeVersionId,
    recipeId,
    versionNo: 1,
    state: "approved",
    plannedInputQty: "1.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: "1.000000",
    yieldRate: "1.000000",
    effectiveFrom,
    effectiveTo: null,
  });
  store.recipeLines.set("rl-1", {
    id: "rl-1",
    recipeVersionId,
    componentKind: "ingredient",
    itemId: base.itemId,
    subRecipeId: null,
    quantity: "500.000000",
    unitId: gramUnitId,
    lossFactor: "1",
    stage: null,
    substitutionGroup: null,
  });

  const draftRecipeId = "recipe-draft";
  store.recipes.set(draftRecipeId, {
    id: draftRecipeId,
    organizationId: base.organizationId,
    code: "DRAFT",
    name: "Draft cake",
    outputItemId,
  });
  const draftRecipeVersionId = "rv-draft";
  store.recipeVersions.set(draftRecipeVersionId, {
    id: draftRecipeVersionId,
    recipeId: draftRecipeId,
    versionNo: 1,
    state: "draft",
    plannedInputQty: "1.000000",
    plannedOutputQty: "1.000000",
    approvedUsableOutput: "1.000000",
    yieldRate: "1.000000",
    effectiveFrom,
    effectiveTo: null,
  });
  store.recipeLines.set("rl-2", {
    id: "rl-2",
    recipeVersionId: draftRecipeVersionId,
    componentKind: "ingredient",
    itemId: base.itemId,
    subRecipeId: null,
    quantity: "500.000000",
    unitId: gramUnitId,
    lossFactor: "1",
    stage: null,
    substitutionGroup: null,
  });

  return {
    ...base,
    gramUnitId,
    outputItemId,
    recipeId,
    recipeVersionId,
    draftRecipeId,
    draftRecipeVersionId,
  };
}

/**
 * In-memory `ProductionBatchCostStore` (`DEC-124`): the recipe port (so
 * `computeRecipeCost` runs unchanged) with the batch/movement and `DEC-112`
 * labour/overhead reads composed in — the `FakeCompositionStore` precedent
 * (`assemble-cost-card-composition.test.ts`). The batch, movements and labour
 * rate are seeded into the embedded `FakeProductionStore`/`FakeCostingStore`; the
 * recipe, items, units, conversions and prices into the inherited recipe maps.
 */
export class FakeProductionBatchCostStore
  extends FakeRecipeStore
  implements ProductionBatchCostStore
{
  readonly production = new FakeProductionStore();
  readonly costing = new FakeCostingStore();
  eligibleProductCount = 0;

  findProductionBatch(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<ProductionBatchRecord | undefined> {
    return this.production.findProductionBatch(query);
  }

  listStockMovements(query: Parameters<ProductionBatchCostStore["listStockMovements"]>[0]) {
    return this.production.listStockMovements(query);
  }

  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }) {
    return this.costing.findEffectiveLaborRate(query);
  }

  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string | null;
  }) {
    return this.costing.listEffectiveOperatingCosts(query);
  }

  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }) {
    return this.costing.listEffectiveAllocationRules(query);
  }

  countEligibleProducts(): Promise<number> {
    return Promise.resolve(this.eligibleProductCount);
  }

  sumSalesVolume(): Promise<{
    readonly revenue: string;
    readonly transactions: string;
    readonly units: string;
  }> {
    return Promise.resolve({ revenue: "0.0000", transactions: "0", units: "0.000000" });
  }
}
