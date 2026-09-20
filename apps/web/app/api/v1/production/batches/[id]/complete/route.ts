import { completeProductionBatch, createPostgresProductionStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { productionLimiters } from "../../../limiters";
import { parseCompleteProductionBatchBody } from "../../../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Completes an in-progress batch atomically (`PROD-002`–`004`): posts the
 * consumption/output movements in one ledger batch and writes the
 * planned+actual+variance+reason lines. The body carries the actual input
 * quantities, the output actual, and the **draw** storage area — there is no
 * WIP/source-draw area on the batch (open point (e)), so the caller must supply
 * it; the batch's own `destinationStorageAreaId` receives the output.
 *
 * Only an in-progress batch can be completed; a non-zero input variance without
 * a reason, a missing draw area or an unstocked output is a 400. Passing an
 * `idempotencyKey` makes a retry replay the original postings.
 *
 * Recorded, not resolved: the body carries one output only (multi-output cost
 * allocation is undefined, open point (c)); quantities are base-unit decimals
 * with no portion field (`DEC-036` partial portions have no column); and
 * `yieldVariancePct` is returned as a stored fact because `PROD-003` has no
 * tolerance/exception store.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, productionLimiters.complete, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseCompleteProductionBatchBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: {
      productionBatchId: string;
      status: string;
      actualOutputQty: string;
      yieldVariancePct: string;
      inputValue: string;
      outputUnitCost: string;
      movementIds: readonly string[];
      inputCount: number;
      outputCount: number;
      replayed: boolean;
    };
    try {
      result = await completeProductionBatch(store, {
        organizationId,
        actorId: session.userId,
        productionBatchId: id,
        actualFinish: parsed.input.actualFinish,
        inputStorageAreaId: parsed.input.inputStorageAreaId,
        inputs: parsed.input.inputs,
        output: parsed.input.output,
        allowNegativeOverride: parsed.input.allowNegativeOverride,
        ...(parsed.input.idempotencyKey === null
          ? {}
          : { idempotencyKey: parsed.input.idempotencyKey }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({
      productionBatchId: result.productionBatchId,
      status: result.status,
      actualOutputQty: result.actualOutputQty,
      yieldVariancePct: result.yieldVariancePct,
      inputValue: result.inputValue,
      outputUnitCost: result.outputUnitCost,
      movementIds: result.movementIds,
      inputCount: result.inputCount,
      outputCount: result.outputCount,
      replayed: result.replayed,
    });
  });
}
