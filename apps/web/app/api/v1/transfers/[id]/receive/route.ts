import { createPostgresTransferStore, receiveStockTransfer } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { transferLimiters } from "../../limiters";
import { parseReceiveTransferBody } from "../../transfer-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `dispatched` → `received` (`DEC-029`): posts the transit → destination batch
 * for the received quantities and records a discrepancy note when they differ
 * from the dispatched quantities. A command rejection (wrong status, a received
 * item that was never dispatched) is a 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, transferLimiters.receiveTransfer, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }
    const body = await readJsonObject(request);
    const parsed = parseReceiveTransferBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTransferStore(getDb().db);
    try {
      const result = await receiveStockTransfer(store, {
        organizationId,
        actorId: session.userId,
        transferId: id,
        received: parsed.input.received.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          lotId: line.lotId,
        })),
        discrepancyNote: parsed.input.discrepancyNote,
        ...(parsed.input.occurredAt === undefined ? {} : { occurredAt: parsed.input.occurredAt }),
      });
      return jsonOk({
        transferId: result.transferId,
        receiptMovementId: result.receiptMovementId,
        hasDiscrepancy: result.hasDiscrepancy,
        discrepancyNote: result.discrepancyNote,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }
  });
}
