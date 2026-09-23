import {
  correctSalesLine,
  createPostgresCorrectSalesLineStore,
  type CorrectSalesLineResult,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { salesLimiters } from "../../../limiters";
import { parseReverseSalesLineBody } from "../../../sales-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reverses one posted sales line and, in the same transaction, every
 * `sales_line`-sourced movement it posted (`DEC-116`, `DEC-028`/`DEC-073`). The
 * original line and movements are never edited or deleted: the correction posts
 * a new negated line and one exact reversal movement per original movement, with
 * a residual `revaluation` where the ledger primitive demands one.
 *
 * The `reasonCode` is mandatory and recorded in the line and movement audits. A
 * line that is itself a reversal or is already reversed is rejected (`DEC-073`)
 * with the authored `DomainError` message.
 *
 * Signed out → 401; a malformed id or body → 400; a rejected correction → 400
 * with the authored `DomainError` message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, salesLimiters.reverseSalesLine, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseReverseSalesLineBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCorrectSalesLineStore(getDb().db);

    let result: CorrectSalesLineResult;
    try {
      result = await correctSalesLine(store, {
        organizationId,
        actorId: session.userId,
        salesLineId: id,
        reasonCode: parsed.reasonCode,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      reversalSalesLineId: result.reversalSalesLineId,
      reversedMovementIds: result.reversedMovementIds,
      revaluationMovementIds: result.revaluationMovementIds,
    });
  });
}
