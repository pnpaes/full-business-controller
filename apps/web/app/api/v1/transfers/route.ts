import {
  createPostgresTransferStore,
  listStockTransfers,
  requestStockTransfer,
} from "@aquarela/application";
import type { StockTransferPage } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import { transferLimiters } from "./limiters";
import { loadTransferRefs } from "./refs";
import { parseRequestTransferBody, parseTransferListQuery, toTransferRows } from "./transfer-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transfers for the served organization (`INV-005`, `INV-007`).
 *
 * Query: optional `status` (the transfer vocabulary), `fromLocationId`/
 * `toLocationId` (UUID) and `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`, each row carrying the
 * movement-derived dispatched/received totals and discrepancy flag. Signed out
 * → 401; a malformed filter → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseTransferListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);

    let page: StockTransferPage;
    try {
      page = await listStockTransfers(store, { organizationId, ...parsed.query });
    } catch (error) {
      // `listStockTransfers` is the single validator of the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    const refs = await loadTransferRefs(store, {
      locationIds: page.transfers.flatMap((row) => [
        row.transfer.fromLocationId,
        row.transfer.toLocationId,
      ]),
      storageAreaIds: page.transfers.flatMap((row) => [
        row.transfer.fromStorageAreaId,
        row.transfer.toStorageAreaId,
      ]),
      itemIds: [],
    });

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toTransferRows(organizationId, page.transfers, refs),
    });
  });
}

/**
 * Opens a transfer in status `requested`. The actor and organization are the
 * session's; the command validates the two physical endpoints and rejects the
 * virtual transit point or an in-transit storage area as an end.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, transferLimiters.createTransfer, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseRequestTransferBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);

    let created: { transferId: string };
    try {
      created = await requestStockTransfer(store, {
        organizationId,
        actorId: session.userId,
        fromLocationId: parsed.input.fromLocationId,
        fromStorageAreaId: parsed.input.fromStorageAreaId,
        toLocationId: parsed.input.toLocationId,
        toStorageAreaId: parsed.input.toStorageAreaId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({ transferId: created.transferId });
  });
}
