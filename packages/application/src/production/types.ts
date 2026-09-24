import type { AuditInput } from "../auth";
import type { ConversionEdge, MasterUnit } from "../catalog";
import type { AllocationRuleRecord, LaborRateRecord, OperatingCostRecord } from "../costing/types";
import type { DataQualityExceptionStore } from "../data-quality";
import type { InventoryMovementListQuery, InventoryStore, StockMovementRecord } from "../inventory";
import type { RecipeStore } from "../recipes/types";

/**
 * Application-level ports and DTOs for slice-10 **production planning + batches**
 * (`PROD-001`–`005`, `WASTE-002`; `DEC-005`, `DEC-031`, `DEC-034`, `DEC-036`).
 *
 * `ProductionStore` extends the slice-8 `InventoryStore`, so the completion
 * command posts its consumption/output movements through the same atomic
 * `postStockMovements` batch and the same locked balances (one ledger writer,
 * `ADR-0005`, `DEC-034`). The recipe/conversion reads are added on top, mirroring
 * `RecipeStore`'s shapes; a single Postgres adapter composes
 * `createPostgresInventoryStore` with the production reads/writes, and a single
 * `FakeProductionStore` composes `FakeInventoryStore`, so the unit suite
 * exercises the real posting path.
 *
 * `timestamptz` columns are carried as ISO strings and `date` columns as
 * `yyyy-mm-dd` strings, like the inventory port.
 *
 * ponytail: the persistence repository exposes **no batch-line update** (only
 * `createProductionBatchInput`/`createProductionBatchOutput` and the two list
 * reads), so this slice writes the planned+actual line rows once, inside the
 * completion transaction, rather than at batch creation. The planned snapshot is
 * derived from the approved recipe version (immutable) at both creation — onto
 * the header's `planned_output_qty` — and completion. The upgrade path is a
 * persistence line-update function pair.
 *
 * Recorded open points — deliberately **not** resolved (see
 * `schema/production.ts`'s matching list and the slice report):
 * (a) no `batch_number`/`code` on plan or batch, so there is no natural key and
 *     idempotency is a caller-supplied deterministic id;
 * (b) `DEC-036` partial-portion handling has no column, so output lines carry
 *     base-unit quantities only (no portion size / partial-portion record);
 * (c) output cost allocation across multiple outputs is undefined, so a batch is
 *     single-output (the recipe's output item) and extra outputs are rejected;
 * (d) planned-vs-actual variance posting vs a linked `waste_event` may
 *     double-count (`WASTE-002`); this slice posts no waste movement;
 * (e) no WIP/source-draw storage area: outputs use the batch's
 *     `destination_storage_area_id`, consumption uses a caller-supplied area,
 *     and an absent area fails clearly;
 * (f) `production_plan` has no status vocabulary authority (`DEC-125` adds the
 *     `production_plan_line` table and `production_batch.planned_qty`, so a plan
 *     now states per line which approved version and how much output is
 *     intended; the plan status itself stays free text);
 * (g) no yield-variance tolerance threshold (`PROD-003`): the `DEC-080`
 *     exception store now exists and a `yield_variance` exception is recorded
 *     unconditionally on a non-zero yield variance (provisional, no threshold
 *     applied yet — the FIN tolerance thresholds remain open);
 * (i) the line-write timing forced by the persistence surface (above).
 */

export type ProductionStatus = "planned" | "released" | "in_progress" | "completed" | "cancelled";

/** One `production_plan` header. `productionDate` is a `date` (`yyyy-mm-dd`). */
export interface ProductionPlanRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly productionDate: string;
  /** No vocabulary authority for the plan; stored as given (open point (f)). */
  readonly status: string;
  /** `DEC-125`: the plan's lines, oldest first. Empty for a header with no lines. */
  readonly lines: readonly ProductionPlanLineRecord[];
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** One `production_plan_line` row (`DEC-125`): a recipe version + intended qty. */
export interface ProductionPlanLineRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly planId: string;
  readonly recipeVersionId: string;
  /** numeric(19,6), strictly positive (`production_plan_line_planned_qty_check`). */
  readonly plannedQty: string;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewProductionPlanLineRecord {
  readonly organizationId: string;
  readonly planId: string;
  readonly recipeVersionId: string;
  readonly plannedQty: string;
}

export interface NewProductionPlanRecord {
  /** Optional deterministic id: a replay of an existing plan is returned as-is. */
  readonly id?: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly productionDate: string;
  readonly status: string;
  readonly createdBy: string | null;
}

/** One `production_batch` header (DATA_DICTIONARY §7, `DEC-031`). */
export interface ProductionBatchRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly workstation: string | null;
  readonly recipeVersionId: string;
  readonly planId: string | null;
  readonly status: string;
  /** `timestamptz`, ISO. */
  readonly plannedStart: string | null;
  readonly actualStart: string | null;
  readonly actualFinish: string | null;
  readonly operatorId: string | null;
  /** Outputs' destination; no WIP/source-draw area exists (open point (e)). */
  readonly destinationStorageAreaId: string | null;
  /** numeric(19,6). */
  readonly plannedOutputQty: string | null;
  /**
   * `DEC-125`: the batch's intended output quantity (numeric(19,6)), null for a
   * batch without a planned quantity (the previous single-batch behaviour).
   */
  readonly plannedQty: string | null;
  readonly actualOutputQty: string | null;
  /** numeric(9,6) fraction, signed (not ×100). */
  readonly yieldVariancePct: string | null;
  /**
   * `DEC-124`: the labour hours actually booked against the batch,
   * `numeric(9,2)`, nullable (not recorded for a batch completed before the
   * column existed). No cost is derived or stored here.
   */
  readonly actualLabourHours: string | null;
  readonly reversalOfId: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewProductionBatchRecord {
  /** Optional deterministic id, the slice's idempotency key (no natural key). */
  readonly id?: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly workstation: string | null;
  readonly recipeVersionId: string;
  readonly planId: string | null;
  readonly status: string;
  /** ISO instant. */
  readonly plannedStart: string | null;
  readonly operatorId: string | null;
  readonly destinationStorageAreaId: string | null;
  /** numeric(19,6). The batch's intended output quantity (`DEC-125`), or null. */
  readonly plannedQty: string | null;
  /** numeric(19,6). */
  readonly plannedOutputQty: string | null;
}

/** Additive header patch for the batch lifecycle (`PROD-002`). */
export interface ProductionBatchPatch {
  readonly status?: string;
  /** ISO instant; `null` clears. */
  readonly actualStart?: string | null;
  readonly actualFinish?: string | null;
  /** numeric(19,6). */
  readonly actualOutputQty?: string | null;
  /** numeric(9,6). */
  readonly yieldVariancePct?: string | null;
  /** numeric(9,2) hours; `DEC-124`. */
  readonly actualLabourHours?: string | null;
  readonly operatorId?: string | null;
  readonly destinationStorageAreaId?: string | null;
}

export interface ProductionBatchInputRecord {
  readonly id: string;
  readonly productionBatchId: string;
  readonly itemId: string;
  readonly unitId: string;
  /** numeric(19,6), the planned snapshot in the item base unit. */
  readonly plannedQty: string;
  /** numeric(19,6), null until the batch completes. */
  readonly actualQty: string | null;
  /** numeric(19,6), `actual − planned`, null until completion. */
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  readonly reasonCode: string | null;
  readonly movementId: string | null;
}

export interface NewProductionBatchInputRecord {
  readonly productionBatchId: string;
  readonly itemId: string;
  readonly unitId: string;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  readonly reasonCode: string | null;
  readonly movementId: string | null;
}

export interface ProductionBatchOutputRecord {
  readonly id: string;
  readonly productionBatchId: string;
  readonly itemId: string;
  readonly unitId: string;
  /** `finished`/`intermediate`/`by_product`/`waste` (DATA_DICTIONARY §7). */
  readonly kind: string;
  /** numeric(19,6). */
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  /** `date` (`yyyy-mm-dd`). */
  readonly expiryDate: string | null;
  readonly movementId: string | null;
}

export interface NewProductionBatchOutputRecord {
  readonly productionBatchId: string;
  readonly itemId: string;
  readonly unitId: string;
  readonly kind: string;
  readonly plannedQty: string;
  readonly actualQty: string | null;
  readonly varianceQty: string | null;
  readonly lotId: string | null;
  readonly expiryDate: string | null;
  readonly movementId: string | null;
}

/** One `recipe` master row, scoped by organization (slice-5 vocabulary). */
export interface ProductionRecipeRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly outputItemId: string | null;
}

/** One `recipe_version` row; `state` is the `document_status` vocabulary. */
export interface ProductionRecipeVersionRecord {
  readonly id: string;
  readonly recipeId: string;
  readonly versionNo: number;
  readonly state: string;
  /** numeric(19,6). */
  readonly plannedInputQty: string;
  readonly plannedOutputQty: string;
  readonly approvedUsableOutput: string;
  /** numeric(9,6). */
  readonly yieldRate: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface ProductionRecipeLineRecord {
  readonly id: string;
  readonly recipeVersionId: string;
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly subRecipeId: string | null;
  /** numeric(19,6). */
  readonly quantity: string;
  readonly unitId: string;
  /** numeric(9,6). */
  readonly lossFactor: string;
  readonly stage: string | null;
  readonly substitutionGroup: string | null;
}

export interface ListProductionPlansQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListProductionBatchesQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly planId?: string;
  readonly workstation?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ProductionStore extends InventoryStore, DataQualityExceptionStore {
  /**
   * Binds `fn` to one transaction and hands it a full `ProductionStore`, so the
   * batch header/lines, the ledger postings and the audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: ProductionStore) => Promise<T>): Promise<T>;

  /** A unit with `isBase`, for the conversion graph (`catalog`'s shape). */
  findMasterUnit(unitId: string): Promise<MasterUnit | undefined>;
  /** Effective (global + item-scoped) conversion edges, for base-unit conversion. */
  listEffectiveConversions(
    organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]>;

  /** Recipe master read (organization-checked by the caller). */
  findRecipe(recipeId: string): Promise<ProductionRecipeRecord | undefined>;
  findRecipeVersion(recipeVersionId: string): Promise<ProductionRecipeVersionRecord | undefined>;
  listRecipeLines(recipeVersionId: string): Promise<readonly ProductionRecipeLineRecord[]>;

  findProductionPlan(query: {
    readonly organizationId: string;
    readonly productionPlanId: string;
  }): Promise<ProductionPlanRecord | undefined>;
  listProductionPlans(query: ListProductionPlansQuery): Promise<readonly ProductionPlanRecord[]>;
  createProductionPlan(input: NewProductionPlanRecord): Promise<ProductionPlanRecord>;

  /** `DEC-125`: the lines of the given plans, organization-scoped, oldest first. */
  listProductionPlanLines(query: {
    readonly organizationId: string;
    readonly planIds: readonly string[];
  }): Promise<readonly ProductionPlanLineRecord[]>;
  createProductionPlanLine(input: NewProductionPlanLineRecord): Promise<ProductionPlanLineRecord>;
  /** One line by id, organization-scoped, or `undefined` (the `planLineId` check). */
  findProductionPlanLine(query: {
    readonly organizationId: string;
    readonly planLineId: string;
  }): Promise<ProductionPlanLineRecord | undefined>;

  findProductionBatch(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<ProductionBatchRecord | undefined>;
  listProductionBatches(
    query: ListProductionBatchesQuery,
  ): Promise<readonly ProductionBatchRecord[]>;
  createProductionBatch(input: NewProductionBatchRecord): Promise<ProductionBatchRecord>;
  updateProductionBatch(
    id: string,
    patch: ProductionBatchPatch,
  ): Promise<ProductionBatchRecord | undefined>;

  listProductionBatchInputs(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<readonly ProductionBatchInputRecord[]>;
  createProductionBatchInput(
    input: NewProductionBatchInputRecord,
  ): Promise<ProductionBatchInputRecord>;

  listProductionBatchOutputs(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<readonly ProductionBatchOutputRecord[]>;
  createProductionBatchOutput(
    input: NewProductionBatchOutputRecord,
  ): Promise<ProductionBatchOutputRecord>;

  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}

/**
 * The store `computeProductionBatchCost` needs (`DEC-124`): the recipe port
 * (so the theoretical cost reuses `computeRecipeCost` unchanged), the batch
 * header read, the ledger movement read and the `DEC-112` labour/overhead
 * reads. Composed by `createPostgresProductionBatchCostStore` the way
 * `CostCardComponentStore` composes the recipe port with the costing reads.
 *
 * It extends `RecipeStore` rather than `ProductionStore` because
 * `computeRecipeCost` is typed to the recipe port and its `findUnit`/`findItem`
 * return the recipe shapes; the production store's `findUnit`/`findItem` are the
 * inventory shapes and cannot satisfy both. The batch and movement reads are
 * added explicitly, so no cast is needed to reuse the recipe-cost engine.
 */
export interface ProductionBatchCostStore extends RecipeStore {
  /** Organization-scoped batch header (a foreign-organization id reads as undefined). */
  findProductionBatch(query: {
    readonly organizationId: string;
    readonly productionBatchId: string;
  }): Promise<ProductionBatchRecord | undefined>;
  /** The ledger movements the query sums; filtered by source type/id for one batch. */
  listStockMovements(query: InventoryMovementListQuery): Promise<readonly StockMovementRecord[]>;

  /** `DEC-112`: the effective labour rate for a `(cost centre, role)` at an instant. */
  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }): Promise<LaborRateRecord | undefined>;
  /** The `DEC-112` allocated-overhead reads (the `resolveAllocatedUnitOverhead` port). */
  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string | null;
  }): Promise<readonly OperatingCostRecord[]>;
  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }): Promise<readonly AllocationRuleRecord[]>;
  countEligibleProducts(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly asOf: Date;
  }): Promise<number>;
  sumSalesVolume(query: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<{
    readonly revenue: string;
    readonly transactions: string;
    readonly units: string;
  }>;
}
