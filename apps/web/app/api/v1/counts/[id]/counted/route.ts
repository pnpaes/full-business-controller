import { createPostgresCountStore, recordCountedLines } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { parseCountedBody } from "../../count-rows";
import { countsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records observed quantities for a count (`INV-004`). The body is a non-empty
 * `lines` array; a line not snapshotted by the count is created with a zero
 * expected snapshot, and a second observation of the same key is a recount. An
 * approved or cancelled count is a 400, as is any malformed line.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, countsLimiters.record, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    const parsed = parseCountedBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);

    let result: { recorded: number; recounted: number };
    try {
      result = await recordCountedLines(store, {
        organizationId,
        actorId: session.userId,
        stockCountId: id,
        lines: parsed.lines,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ recorded: result.recorded, recounted: result.recounted });
  });
}
