import {
  computeProductionBatchCost,
  createPostgresProductionBatchCostStore,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../lib/server-session";
import { parseProductionBatchCostQuery, toProductionBatchCostRow } from "../../../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "production batch not found in organization";

/**
 * The realistic batch cost (`DEC-124`), computed on read — no cost is stored.
 * The batch must be `completed`; an incomplete batch is a 400 and a malformed,
 * unknown or foreign id is 400/404.
 *
 * The optional `costPoolId` charges the pool's per-unit allocation × actual
 * output; `periodFrom`/`periodTo` narrow the allocation period (default: the
 * month containing the actual finish). Without a pool the overhead is reported
 * as zero with a provenance note. The response carries the provenance notes
 * verbatim so the screen can explain every zero.
 */
export async function GET(
  request: Request,
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

    const parsed = parseProductionBatchCostQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionBatchCostStore(getDb().db);
    try {
      const cost = await computeProductionBatchCost(store, {
        organizationId,
        productionBatchId: id,
        ...parsed.query,
      });
      return jsonOk({ cost: toProductionBatchCostRow(cost) });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error.message === NOT_FOUND ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}
