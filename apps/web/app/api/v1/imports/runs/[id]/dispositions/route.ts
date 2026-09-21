import { createPostgresImportStore, disposeStagingRow } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { parseDisposeStagingRowBody } from "../../../import-rows";
import { importLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records an approved disposition for a non-posted row (`SALE-007`, `DEC-035`):
 * the run cannot close while a non-posted row lacks one. Dispositions live in
 * the first-class `import_disposition` table, one row per staging row
 * (`DEC-083`); the actor recording it is the approval — there is no approval
 * workflow in this slice. `disposeStagingRow` refuses a second disposition for a
 * row (the unique key), which surfaces as a 400 via the `DomainError` handling.
 *
 * A `rejected` disposition requires a reason, and a row already linked to a
 * posted sales line cannot be dispositioned (correcting it is a slice-12
 * reversal). Posting does not exist in slice 11, so no row is linked yet. Signed
 * out → 401; unknown run/row or an unknown disposition → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, importLimiters.review, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseDisposeStagingRowBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);

    let result: {
      importRunId: string;
      stagingRowId: string;
      disposition: string;
      mappingState: string;
      runStatus: string;
    };
    try {
      result = await disposeStagingRow(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
        stagingRowId: parsed.input.stagingRowId,
        disposition: parsed.input.disposition,
        ...(parsed.input.reason === null ? {} : { reason: parsed.input.reason }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      importRunId: result.importRunId,
      stagingRowId: result.stagingRowId,
      disposition: result.disposition,
      mappingState: result.mappingState,
      runStatus: result.runStatus,
    });
  });
}
