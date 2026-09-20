import { createPostgresReceivingStore, getGoodsReceipt } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { toReceiptLineRows, toReceiptRows } from "../receipt-http";
import { loadReceiptRefs } from "../receipt-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One receipt and its lines, scoped to the served organization. Signed out → 401;
 * a receipt that does not exist in this organization → 404 (never another
 * tenant's data). Response: `{ ok: true, receipt, lines }`.
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
    const organizationId = resolveOrganization();
    const store = createPostgresReceivingStore(getDb().db);
    const detail = await getGoodsReceipt(store, { organizationId, receiptId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const refs = await loadReceiptRefs(store, organizationId, detail.lines);
    return jsonOk({
      receipt: toReceiptRows(organizationId, [detail.receipt], refs)[0] ?? null,
      lines: toReceiptLineRows(organizationId, detail.lines, refs),
    });
  });
}
