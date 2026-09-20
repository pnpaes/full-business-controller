import { createPostgresImportStore, mapImportRows } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { parseMapImportRowsBody } from "../../../import-rows";
import { importLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies the SKU-first resolver to every staged row (`SALE-002`, `DEC-041`,
 * step 5). A `DEC-033` conflict is flagged and blocked — the row gets
 * `mapping_state = conflict` (`error_code = mapping_conflict` retained as detail)
 * and is never remapped in place. Rows already ignored
 * or carrying a validation error are skipped, so mapping cannot overwrite a
 * human decision. The run moves to `needs_review` while any row is unmapped or
 * in conflict, else `validated`.
 *
 * No posting happens here. Signed out → 401; a malformed body → 400.
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

    const parsed = parseMapImportRowsBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);

    let result: {
      importRunId: string;
      status: string;
      mappedCount: number;
      unmappedCount: number;
      conflictCount: number;
      skippedCount: number;
    };
    try {
      result = await mapImportRows(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
        ...(parsed.input.sourceSystem === null ? {} : { sourceSystem: parsed.input.sourceSystem }),
        ...(parsed.input.entityType === null ? {} : { entityType: parsed.input.entityType }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      importRunId: result.importRunId,
      status: result.status,
      mappedCount: result.mappedCount,
      unmappedCount: result.unmappedCount,
      conflictCount: result.conflictCount,
      skippedCount: result.skippedCount,
    });
  });
}
