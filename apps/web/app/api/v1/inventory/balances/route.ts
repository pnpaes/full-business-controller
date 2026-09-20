import { createPostgresInventoryStore, getStockBalanceAsOf } from "@aquarela/application";
import type { StockBalanceAsOfEntry } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { loadBalanceRefs } from "../refs";
import { parseBalanceQuery, toBalanceRows } from "./balance-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only as-of stock balances for the served organization (INV-002).
 *
 * Query: `?asOf=<ISO instant>` (default: request time), optional `?itemId=` and
 * `?locationId=` (UUID). Response: `{ ok: true, asOf, rows }`. Signed out → 401;
 * a malformed filter or cutoff → 400. Never returns another organization's rows.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseBalanceQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);

    let balances: readonly StockBalanceAsOfEntry[];
    try {
      balances = await getStockBalanceAsOf(store, { organizationId, ...parsed.query });
    } catch (error) {
      // `getStockBalanceAsOf` is the single validator of the `asOf` instant.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    const refs = await loadBalanceRefs(store, balances);
    return jsonOk({
      asOf: parsed.query.asOf,
      rows: toBalanceRows(organizationId, balances, refs),
    });
  });
}
