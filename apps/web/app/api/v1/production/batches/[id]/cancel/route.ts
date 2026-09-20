import { createPostgresProductionStore, cancelProductionBatch } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { productionLimiters } from "../../../limiters";
import { parseCancelProductionBatchBody } from "../../../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cancels a batch that has not completed (`PROD-001`): `planned`/`released`/
 * `in_progress → cancelled`. A completed batch is a 400 — its movements are in
 * the append-only ledger, so undoing them is a `DEC-028` reversal. Body:
 * optional `reason` recorded on the audit fact.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productionLimiters.lifecycle, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseCancelProductionBatchBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: { status: string };
    try {
      result = await cancelProductionBatch(store, {
        organizationId,
        actorId: session.userId,
        productionBatchId: id,
        ...(parsed.reason === null ? {} : { reason: parsed.reason }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ status: result.status });
  });
}
