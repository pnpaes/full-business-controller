import {
  assessReceiptVariances,
  createPostgresReceivingStore,
  listGoodsReceipts,
  recordGoodsReceipt,
} from "@aquarela/application";
import type { RecordGoodsReceiptInput } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { assertSameOrigin } from "../../../../../lib/same-origin";
import { getServerSession } from "../../../../../lib/server-session";

import { parseReceiptBody } from "./parse-receipt-body";
import { parseReceiptListQuery, toReceiptRows } from "./receipt-http";
import { loadReceiptRefs } from "./receipt-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only receipt list for the served organization (PROC-002 surface).
 *
 * Query: optional `?locationId=`/`?supplierId=` (UUID) and
 * `?limit=`/`?offset=`. Response: `{ ok: true, receipts: [...] }`. Signed out →
 * 401; a malformed filter → 400. Never returns another organization's rows.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseReceiptListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReceivingStore(getDb().db);

    let receipts;
    try {
      receipts = await listGoodsReceipts(store, { organizationId, ...parsed.query });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    const refs = await loadReceiptRefs(store, organizationId, []);
    return jsonOk({ receipts: toReceiptRows(organizationId, receipts, refs) });
  });
}

/**
 * Records an accepted goods receipt through the existing application command.
 * The actor is the session user, the organization is server-resolved, the body is
 * shape-validated at the boundary, and the response carries the §8.3 variance
 * warnings (accepted/price) computed from what was actually recorded.
 */
export async function POST(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    try {
      assertSameOrigin(request);
    } catch {
      return jsonError(403);
    }

    const parsed = parseReceiptBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReceivingStore(getDb().db);
    const input: RecordGoodsReceiptInput = {
      organizationId,
      actorId: session.userId,
      locationId: parsed.input.locationId,
      supplierId: parsed.input.supplierId,
      storeName: parsed.input.storeName,
      deliveryRef: parsed.input.deliveryRef,
      receivedAt: new Date(parsed.input.receivedAt),
      ...(parsed.input.currency === undefined ? {} : { currency: parsed.input.currency }),
      lines: parsed.input.lines,
    };

    let result;
    try {
      result = await recordGoodsReceipt(store, input);
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    const warnings = assessReceiptVariances(
      result.lines.map((line, index) => ({
        lineIndex: index,
        receivedPackQty: parsed.input.lines[index]!.receivedPackQty,
        acceptedPackQty: parsed.input.lines[index]!.acceptedPackQty,
        previousLandedBaseUnitCost: line.previousLandedBaseUnitCost,
        landedBaseUnitCost: line.landedBaseUnitCost,
      })),
    );

    return jsonOk({ goodsReceiptId: result.goodsReceiptId, lines: result.lines, warnings });
  });
}
