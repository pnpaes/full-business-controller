import { createPostgresSalesStore, getSalesTransaction } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { loadSalesRefs } from "../../sales-refs";
import { toSalesLineRows, toSalesTransactionRows } from "../../sales-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One sales transaction with its lines (`SALE-003`/`009`), organization-scoped
 * (`DEC-061`). Signed out → 401; a malformed id → 400; an unknown or foreign
 * transaction → 404.
 *
 * The line `appliedTaxRate` is the rate actually applied, captured verbatim
 * (`DEC-042`/`DEC-045`) and never re-derived; an `included` option line is
 * retained for consumption but excluded from the header totals (`DEC-043`).
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
    const db = getDb().db;
    const store = createPostgresSalesStore(db);
    const detail = await getSalesTransaction(store, { organizationId, salesTransactionId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const refs = await loadSalesRefs(db, organizationId, [detail.transaction]);
    const lineCounts = new Map([[detail.transaction.id, detail.lines.length]]);
    const rows = toSalesTransactionRows(organizationId, [detail.transaction], refs, lineCounts);

    return jsonOk({
      transaction: rows[0] ?? null,
      lines: toSalesLineRows(organizationId, detail.lines),
    });
  });
}
