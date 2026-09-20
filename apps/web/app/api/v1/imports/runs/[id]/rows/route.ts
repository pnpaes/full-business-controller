import { createPostgresImportStore, stageImportRows } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { parseStageRowsBody } from "../../../import-rows";
import { importLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stages parsed rows into a run that is still `uploaded` (`SALE-004`, step 3).
 *
 * Every well-formed row is retained: a semantically invalid row is staged and
 * left for `validateImportRun` to mark, never dropped. Only a structurally
 * impossible row is a 400, as is a run that is not awaiting staging (so a
 * replayed call cannot duplicate rows). Signed out → 401; unknown/foreign run →
 * 400 (the command resolves the run organization-scoped).
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, importLimiters.stageRows, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseStageRowsBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);

    let result: { importRunId: string; stagedCount: number; status: string };
    try {
      result = await stageImportRows(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
        rows: parsed.rows,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      importRunId: result.importRunId,
      stagedCount: result.stagedCount,
      status: result.status,
    });
  });
}
