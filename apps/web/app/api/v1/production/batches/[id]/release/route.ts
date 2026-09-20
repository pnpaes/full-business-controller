import { createPostgresProductionStore, releaseProductionBatch } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { productionLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Releases a planned batch into the queue (`PROD-001`): `planned → released`.
 * Only a planned batch can be released; an in-progress or completed batch is a
 * 400. No body is read.
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

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: { status: string };
    try {
      result = await releaseProductionBatch(store, {
        organizationId,
        actorId: session.userId,
        productionBatchId: id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({ status: result.status });
  });
}
