import { createPostgresCountStore, getStockCount } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { loadCountLineRefs, toCountLineRows } from "../count-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One count with its lines and variances (`INV-004`). A blind, unapproved count
 * returns `expectedQty: null` / `varianceQty: null` and `expectedHidden: true`,
 * so the payload cannot leak the book quantities a blind count hides (`DEC-017`).
 * Signed out → 401; a malformed or unknown id → 400/404.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);
    const detail = await getStockCount(store, { organizationId, stockCountId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const [location, refs] = await Promise.all([
      store.findLocation(detail.count.locationId),
      loadCountLineRefs(store, organizationId, detail.lines),
    ]);

    return jsonOk({
      count: {
        id: detail.count.id,
        locationId: detail.count.locationId,
        locationCode: location?.organizationId === organizationId ? location.code : null,
        locationName: location?.organizationId === organizationId ? location.name : null,
        scope: detail.count.scope,
        blind: detail.count.blind,
        cutoff: detail.count.cutoff,
        status: detail.count.status,
        createdBy: detail.count.createdBy,
        createdAt: detail.count.createdAt,
        approvedBy: detail.count.approvedBy,
        approvedAt: detail.count.approvedAt,
        expectedHidden: detail.expectedHidden,
      },
      lines: toCountLineRows(organizationId, detail.lines, refs),
    });
  });
}
