import { createPostgresReconciliationStore, listReconciliations } from "@aquarela/application";

import { getDb } from "../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { parseReconciliationListQuery, toReconciliationRows } from "./reconciliation-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reconciliation rows for the served organization (`REC-005`), newest period
 * first.
 *
 * Query: optional `status` (reconciliation vocabulary), `scopeType` (free text,
 * open point (j)), `scopeId` (UUID), `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`. Signed out → 401; a malformed
 * filter → 400. Never returns another organization's rows.
 *
 * There is no tolerance-configuration table (open point (b)): the row carries
 * the per-reconciliation tolerance **snapshot**, not the FIN-owned effective
 * configuration, and no threshold is re-applied on read.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseReconciliationListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReconciliationStore(getDb().db);
    const page = await listReconciliations(store, { organizationId, ...parsed.query });

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toReconciliationRows(organizationId, page.reconciliations),
    });
  });
}
