import { createPostgresTransferStore, dispatchStockTransfer } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { transferLimiters } from "../../limiters";
import { parseDispatchTransferBody } from "../../transfer-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `approved` → `dispatched` (`DEC-029`): posts the source → transit batch for
 * the supplied lines and stamps the header. A non-UUID id or malformed body is a
 * 400, as is any command rejection (unknown/foreign transfer, wrong status, no
 * transit point configured, negative stock without an authorized override).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, transferLimiters.dispatchTransfer, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }
    const body = await readJsonObject(request);
    const parsed = parseDispatchTransferBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);
    try {
      const result = await dispatchStockTransfer(store, {
        organizationId,
        actorId: session.userId,
        transferId: id,
        lines: parsed.input.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          lotId: line.lotId,
        })),
        ...(parsed.input.occurredAt === undefined ? {} : { occurredAt: parsed.input.occurredAt }),
        ...(parsed.input.allowNegativeOverride ? { allowNegativeOverride: true } : {}),
        reasonCode: parsed.input.reasonCode,
      });
      return jsonOk({
        transferId: result.transferId,
        dispatchMovementId: result.dispatchMovementId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
