import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import {
  productionBatch,
  productionBatchInput,
  productionBatchOutput,
  productionPlan,
} from "../schema";

export type ProductionPlan = typeof productionPlan.$inferSelect;
export type NewProductionPlan = typeof productionPlan.$inferInsert;
export type ProductionBatch = typeof productionBatch.$inferSelect;
export type NewProductionBatch = typeof productionBatch.$inferInsert;
export type ProductionBatchInput = typeof productionBatchInput.$inferSelect;
export type NewProductionBatchInput = typeof productionBatchInput.$inferInsert;
export type ProductionBatchOutput = typeof productionBatchOutput.$inferSelect;
export type NewProductionBatchOutput = typeof productionBatchOutput.$inferInsert;

/*
 * Slice-10 production reads/writes (`PROD-001`–`005`, `DEC-031`, `DEC-036`).
 *
 * There is **no natural key** on `production_plan` or `production_batch`
 * (no `batch_number`/`code` in any authority — open point (a), see
 * `schema/production.ts`), so there is deliberately **no `findOrCreate`** path
 * here, unlike `findOrCreateStockCountLine`. Re-planning or re-running a batch
 * creates a new row; idempotency is the caller's concern. The batch line tables
 * carry no organization column of their own, so their reads are scoped through
 * the parent `production_batch` join (mirrors `listStockCountLines`).
 *
 * `updateProductionBatch` is an additive patch for the completion lifecycle
 * (status/timestamps/actuals, `PROD-002`), not a full-row replace. Reversal
 * (`reversal_of_id`) follows `DEC-028` via the ledger, not by editing a batch.
 */

export async function createProductionPlan(
  db: Database,
  input: NewProductionPlan,
): Promise<ProductionPlan> {
  const rows = await db.insert(productionPlan).values(input).returning();
  return rows[0]!;
}

export interface FindProductionPlanQuery {
  readonly organizationId: string;
  readonly productionPlanId: string;
}

/** One plan by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findProductionPlan(
  db: Database,
  query: FindProductionPlanQuery,
): Promise<ProductionPlan | undefined> {
  const rows = await db
    .select()
    .from(productionPlan)
    .where(
      and(
        eq(productionPlan.id, query.productionPlanId),
        eq(productionPlan.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListProductionPlansQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Plans for one organization, newest production date first (`production_date`,
 * then `id`), with optional location/status filters. Every filter is optional
 * except the organization, so the caller never sees another tenant's rows.
 * Paging is applied after the ordering.
 */
export async function listProductionPlans(
  db: Database,
  query: ListProductionPlansQuery,
): Promise<ProductionPlan[]> {
  const statement = db
    .select()
    .from(productionPlan)
    .where(
      and(
        eq(productionPlan.organizationId, query.organizationId),
        query.locationId === undefined
          ? undefined
          : eq(productionPlan.locationId, query.locationId),
        query.status === undefined ? undefined : eq(productionPlan.status, query.status),
      ),
    )
    .orderBy(desc(productionPlan.productionDate), desc(productionPlan.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export async function createProductionBatch(
  db: Database,
  input: NewProductionBatch,
): Promise<ProductionBatch> {
  const rows = await db.insert(productionBatch).values(input).returning();
  return rows[0]!;
}

export interface FindProductionBatchQuery {
  readonly organizationId: string;
  readonly productionBatchId: string;
}

/** One batch by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findProductionBatch(
  db: Database,
  query: FindProductionBatchQuery,
): Promise<ProductionBatch | undefined> {
  const rows = await db
    .select()
    .from(productionBatch)
    .where(
      and(
        eq(productionBatch.id, query.productionBatchId),
        eq(productionBatch.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
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

/**
 * Batches for one organization, newest first (`created_at`, then `id`), with
 * optional location/status/plan/workstation filters. Every filter is optional
 * except the organization, so the caller never sees another tenant's rows.
 */
export async function listProductionBatches(
  db: Database,
  query: ListProductionBatchesQuery,
): Promise<ProductionBatch[]> {
  const statement = db
    .select()
    .from(productionBatch)
    .where(
      and(
        eq(productionBatch.organizationId, query.organizationId),
        query.locationId === undefined
          ? undefined
          : eq(productionBatch.locationId, query.locationId),
        query.status === undefined ? undefined : eq(productionBatch.status, query.status),
        query.planId === undefined ? undefined : eq(productionBatch.planId, query.planId),
        query.workstation === undefined
          ? undefined
          : eq(productionBatch.workstation, query.workstation),
      ),
    )
    .orderBy(desc(productionBatch.createdAt), desc(productionBatch.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface ProductionBatchPatch {
  status?: string;
  plannedStart?: Date | null;
  actualStart?: Date | null;
  actualFinish?: Date | null;
  actualOutputQty?: string | null;
  yieldVariancePct?: string | null;
  operatorId?: string | null;
  destinationStorageAreaId?: string | null;
}

/**
 * Narrow, additive update for the batch lifecycle (`PROD-002`): status, the
 * planned/actual timestamps and the actual-output/yield facts. The schema's
 * `production_batch_status_check` and `production_batch_actual_range_check`
 * still govern which combinations are legal. Patching to `completed` does not
 * post the ledger movements — the application posts them atomically and passes
 * the resulting `movement_id`s to the line inserts.
 */
export async function updateProductionBatch(
  db: Database,
  id: string,
  patch: ProductionBatchPatch,
): Promise<ProductionBatch | undefined> {
  const rows = await db
    .update(productionBatch)
    .set(patch)
    .where(eq(productionBatch.id, id))
    .returning();
  return rows[0];
}

export async function createProductionBatchInput(
  db: Database,
  input: NewProductionBatchInput,
): Promise<ProductionBatchInput> {
  const rows = await db.insert(productionBatchInput).values(input).returning();
  return rows[0]!;
}

export async function createProductionBatchOutput(
  db: Database,
  input: NewProductionBatchOutput,
): Promise<ProductionBatchOutput> {
  const rows = await db.insert(productionBatchOutput).values(input).returning();
  return rows[0]!;
}

export interface ListProductionBatchLinesQuery {
  readonly organizationId: string;
  readonly productionBatchId: string;
}

/**
 * Inputs of one batch (unordered — the dictionary has no sequence column),
 * organization-scoped through the parent batch.
 */
export async function listProductionBatchInputs(
  db: Database,
  query: ListProductionBatchLinesQuery,
): Promise<ProductionBatchInput[]> {
  const rows = await db
    .select({ line: productionBatchInput })
    .from(productionBatchInput)
    .innerJoin(productionBatch, eq(productionBatch.id, productionBatchInput.productionBatchId))
    .where(
      and(
        eq(productionBatchInput.productionBatchId, query.productionBatchId),
        eq(productionBatch.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(productionBatchInput.itemId));
  return rows.map((row) => row.line);
}

/** Outputs of one batch, organization-scoped through the parent batch. */
export async function listProductionBatchOutputs(
  db: Database,
  query: ListProductionBatchLinesQuery,
): Promise<ProductionBatchOutput[]> {
  const rows = await db
    .select({ line: productionBatchOutput })
    .from(productionBatchOutput)
    .innerJoin(productionBatch, eq(productionBatch.id, productionBatchOutput.productionBatchId))
    .where(
      and(
        eq(productionBatchOutput.productionBatchId, query.productionBatchId),
        eq(productionBatch.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(productionBatchOutput.itemId));
  return rows.map((row) => row.line);
}
