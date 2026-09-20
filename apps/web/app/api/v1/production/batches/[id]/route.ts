import { createPostgresProductionStore, getProductionBatch } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  loadProductionRefs,
  toProductionBatchInputRows,
  toProductionBatchOutputRows,
  toProductionBatchRows,
} from "../../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One batch with its persisted input/output lines (`PROD-001`–`004`).
 *
 * The lines are empty until the batch completes: the persistence repository has
 * no batch-line update, so planned+actual rows are written inside the completion
 * transaction (open point (i)). The screen therefore resolves the planned
 * snapshot from the recipe version for a batch that is not yet complete.
 *
 * Signed out → 401; a malformed or unknown/foreign id → 400/404.
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
    const store = createPostgresProductionStore(getDb().db);
    const detail = await getProductionBatch(store, { organizationId, productionBatchId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    const refs = await loadProductionRefs(
      store,
      organizationId,
      [detail.batch],
      detail.inputs,
      detail.outputs,
    );
    const [batch] = toProductionBatchRows(organizationId, [detail.batch], refs);

    return jsonOk({
      batch: batch ?? null,
      inputs: toProductionBatchInputRows(organizationId, detail.inputs, refs),
      outputs: toProductionBatchOutputRows(organizationId, detail.outputs, refs),
    });
  });
}
