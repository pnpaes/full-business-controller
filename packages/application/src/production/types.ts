import type { AuditInput } from "../auth";
import type { ConversionEdge, MasterUnit } from "../catalog";
import type { DataQualityExceptionStore } from "../data-quality";
import type { InventoryStore } from "../inventory";

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
 * (f) `production_plan` has no line/quantity table, so a plan is a dated header;
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
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
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
  readonly actualOutputQty: string | null;
  /** numeric(9,6) fraction, signed (not ×100). */
  readonly yieldVariancePct: string | null;
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
