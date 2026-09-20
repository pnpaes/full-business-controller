import { createPostgresProductionStore, startProductionBatch } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { productionLimiters } from "../../../limiters";
import { parseStartProductionBatchBody } from "../../../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts a released batch (`PROD-001`): `released → in_progress`, stamping
 * `actual_start`. Only a released batch can be started, so the release step
 * cannot be skipped. Body: optional `actualStart` (ISO instant; defaults to
 * now server-side).
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
    const parsed = parseStartProductionBatchBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: { status: string; actualStart: string | null };
    try {
      result = await startProductionBatch(store, {
        organizationId,
        actorId: session.userId,
        productionBatchId: id,
        ...(parsed.actualStart === null ? {} : { actualStart: parsed.actualStart }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ status: result.status, actualStart: result.actualStart });
  });
}
