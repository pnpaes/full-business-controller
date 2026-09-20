import { approveStockCount, createPostgresCountStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { parseApproveBody } from "../../count-rows";
import { countsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Approves a count (`INV-004`, `DEC-017`): posts the variances as one atomic
 * `count_adjustment` batch and marks the count approved. A positive variance
 * with neither a body `unitCost` nor an item `current_cost` is a 400 (the guard);
 * an approved or cancelled count is a 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, countsLimiters.approve, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseApproveBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);

    let result: { movementIds: readonly string[]; varianceCount: number; status: string };
    try {
      result = await approveStockCount(store, {
        organizationId,
        actorId: session.userId,
        stockCountId: id,
        unitCost: parsed.input.unitCost,
        reasonCode: parsed.input.reasonCode,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      movementIds: result.movementIds,
      varianceCount: result.varianceCount,
      status: result.status,
    });
  });
}
