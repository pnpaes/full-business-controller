import { createPostgresSalesStore, listSalesTransactions } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { loadSalesRefs } from "../sales-refs";
import { parseSalesTransactionListQuery, toSalesTransactionRows } from "../sales-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Posted sales transactions for the served organization (`SALE-003`), newest
 * `occurred_at` first.
 *
 * Query: optional `sourceSystem` (free text), `locationId` (UUID),
 * `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`. Signed out → 401; a malformed
 * filter → 400. Never returns another organization's transactions.
 *
 * `lineCount` is loaded per transaction because the header carries no line
 * count; the page is bounded, so this stays a bounded N+1 (the production
 * reference-loader precedent).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseSalesTransactionListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const store = createPostgresSalesStore(db);
    const page = await listSalesTransactions(store, { organizationId, ...parsed.query });

    const lineCounts = new Map<string, number>();
    for (const transaction of page.transactions) {
      const lines = await store.listSalesLines({
        organizationId,
        salesTransactionId: transaction.id,
      });
      lineCounts.set(transaction.id, lines.length);
    }

    const refs = await loadSalesRefs(db, organizationId, page.transactions);

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toSalesTransactionRows(organizationId, page.transactions, refs, lineCounts),
    });
  });
}
