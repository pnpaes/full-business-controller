import {
  createPostgresInventoryStore,
  listStockMovements,
  postStockMovement,
  type PostStockMovementResult,
  type StockMovementPage,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { randomUUID } from "node:crypto";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { inventoryLimiters } from "../limiters";
import { parseMovementQuery, parsePostMovementBody, toMovementRows } from "../movement-rows";
import { loadMovementRefs, loadReversedIds } from "../refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Movement history for the served organization (INV-001, 08_UI_UX.md §8.3
 * movement drill-down).
 *
 * Query: optional `itemId`/`locationId`/`storageAreaId`/`lotId` (`lotId=none`
 * selects the no-lot movements), an optional `from`/`to` ISO-instant window and
 * `limit`/`offset` paging. Response: `{ ok: true, limit, offset, hasMore, rows }`.
 * Signed out → 401; a malformed filter → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseMovementQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);

    let page: StockMovementPage;
    try {
      page = await listStockMovements(store, { organizationId, ...parsed.query });
    } catch (error) {
      // `listStockMovements` is the single validator of the ISO window.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    const [refs, reversedIds] = await Promise.all([
      loadMovementRefs(store, page.movements),
      loadReversedIds(store, page.movements),
    ]);

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toMovementRows(organizationId, page.movements, refs, reversedIds),
    });
  });
}

/**
 * Posts one manual movement (adjustment or waste). The actor is the session
 * user; the organization is the served tenant; the source is generated here
 * because a manual adjustment has no upstream document. The DEC-010 negative
 * override is a request, not an authorization: `postStockMovement` rejects it
 * unless the actor holds a qualifying role. A command rejection (bad vocabulary,
 * negative stock, missing inbound cost, unauthorized override) is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, inventoryLimiters.postMovement, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parsePostMovementBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);

    let result: PostStockMovementResult;
    try {
      result = await postStockMovement(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        storageAreaId: parsed.input.storageAreaId,
        itemId: parsed.input.itemId,
        movementType: parsed.input.movementType,
        sourceType: parsed.input.sourceType,
        sourceId: randomUUID(),
        quantityDelta: parsed.input.quantityDelta,
        unitCost: parsed.input.unitCost,
        occurredAt: parsed.input.occurredAt ?? new Date().toISOString(),
        lotId: parsed.input.lotId,
        reasonCode: parsed.input.reasonCode,
        idempotencyKey: parsed.input.idempotencyKey,
        allowNegativeOverride: parsed.input.allowNegativeOverride,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      movementId: result.movementId,
      replayed: result.replayed,
      quantityOnHand: result.quantityOnHand,
      valueOnHand: result.valueOnHand,
      avgUnitCost: result.avgUnitCost,
      negativeOverride: result.negativeOverride,
    });
  });
}
