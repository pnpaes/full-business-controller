import {
  createPostgresInventoryStore,
  reverseStockMovement,
  type ReverseStockMovementResult,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { inventoryLimiters } from "../../../limiters";
import { parseReverseBody } from "../../../movement-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reverses one posted movement (DEC-028). The reason is mandatory. The offset is
 * the exact negation of the original, and any cleanable residual is cleared by a
 * `revaluation` correction inside the same transaction, so the balance is exact
 * at every cutoff. A movement already reversed, a `revaluation` movement, or an
 * unknown id is a 400; the DEC-010 override (when the reversal would drive stock
 * negative) still requires the actor's manager role.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, inventoryLimiters.reverseMovement, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseReverseBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);

    let result: ReverseStockMovementResult;
    try {
      result = await reverseStockMovement(store, {
        organizationId,
        actorId: session.userId,
        movementId: id,
        reasonCode: parsed.reasonCode,
        allowNegativeOverride: parsed.allowNegativeOverride,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({
      reversalMovementId: result.reversalMovementId,
      revaluationMovementId: result.revaluationMovementId,
      quantityOnHand: result.quantityOnHand,
      valueOnHand: result.valueOnHand,
      avgUnitCost: result.avgUnitCost,
    });
  });
}
