import {
  createPostgresProductionStore,
  createProductionBatch,
  listProductionBatches,
} from "@aquarela/application";
import type { CreateProductionBatchResult } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { productionLimiters } from "../limiters";
import {
  loadProductionRefs,
  parseCreateProductionBatchBody,
  parseProductionBatchListQuery,
  toProductionBatchRows,
} from "../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production batches for the served organization (`PROD-001`), newest first.
 *
 * Query: optional `locationId`/`planId` (UUID), `status` (batch vocabulary),
 * `workstation`, `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`. Signed out → 401; a malformed
 * filter → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseProductionBatchListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);
    const page = await listProductionBatches(store, { organizationId, ...parsed.query });
    const refs = await loadProductionRefs(store, organizationId, page.batches);

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toProductionBatchRows(organizationId, page.batches, refs),
    });
  });
}

/**
 * Plans a batch against an **approved** recipe version (`PROD-001`). The actor
 * is the session user and the organization the served tenant. A command
 * rejection (unapproved version, unknown location/plan/area, non-stocked
 * output) is a 400. A caller-supplied `productionBatchId` is the idempotency
 * path: a replay returns the existing batch (`replayed: true`).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, productionLimiters.createBatch, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseCreateProductionBatchBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: CreateProductionBatchResult;
    try {
      result = await createProductionBatch(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        recipeVersionId: parsed.input.recipeVersionId,
        planId: parsed.input.planId,
        workstation: parsed.input.workstation,
        plannedStart: parsed.input.plannedStart,
        operatorId: parsed.input.operatorId,
        destinationStorageAreaId: parsed.input.destinationStorageAreaId,
        plannedQty: parsed.input.plannedQty,
        planLineId: parsed.input.planLineId,
        ...(parsed.input.productionBatchId === null
          ? {}
          : { productionBatchId: parsed.input.productionBatchId }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      productionBatchId: result.productionBatchId,
      status: result.status,
      plannedOutputQty: result.plannedOutputQty,
      plannedQty: result.plannedQty,
      plannedInputCount: result.plannedInputs.length,
      plannedOutputCount: result.plannedOutputs.length,
      replayed: result.replayed,
    });
  });
}
