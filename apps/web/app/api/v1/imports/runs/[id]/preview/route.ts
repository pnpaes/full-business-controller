import { createPostgresImportStore, previewImportRun } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../lib/server-session";

import { toPreviewJson } from "../../../import-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only reconciliation preview (`SALE-007`, step 6; `DEC-035`): the source
 * totals versus mapped/unmapped/errored and the residual.
 *
 * `postedTotals` is always `{}` in slice 11 — posting is row 12, owner-gated on
 * `ADR-0008` — so the residual is `source - dispositions`, reported for
 * visibility only. No tolerance configuration table exists, so no threshold is
 * applied. Signed out → 401; malformed id → 400; unknown/foreign run → 404.
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
    const store = createPostgresImportStore(getDb().db);

    try {
      const preview = await previewImportRun(store, { organizationId, importRunId: id });
      return jsonOk({ preview: toPreviewJson(preview) });
    } catch (error) {
      // `previewImportRun`'s only DomainError is "not found in organization".
      if (error instanceof DomainError) {
        return jsonError(404, error.message);
      }
      throw error;
    }
  });
}
