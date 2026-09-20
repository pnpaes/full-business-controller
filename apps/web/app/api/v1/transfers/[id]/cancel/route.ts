import { cancelStockTransfer, createPostgresTransferStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { transferLimiters } from "../../limiters";
import { parseCancelTransferBody } from "../../transfer-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cancels a transfer that has not moved stock (`draft`/`requested`/`approved`).
 * A dispatched transfer cannot be cancelled (400) — the ledger already holds the
 * dispatch leg.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, transferLimiters.cancelTransfer, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }
    const body = await readJsonObject(request);
    const parsed = parseCancelTransferBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);
    try {
      const result = await cancelStockTransfer(store, {
        organizationId,
        actorId: session.userId,
        transferId: id,
        reasonCode: parsed.reasonCode,
      });
      return jsonOk({ transferId: result.transferId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }
  });
}
