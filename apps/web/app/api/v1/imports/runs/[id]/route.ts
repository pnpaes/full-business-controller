import { createPostgresImportStore, getImportRun } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { getServerSession } from "../../../../../../lib/server-session";

import { toStagingRowRows } from "../../import-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One import run with its staging rows and diagnostics (`SALE-004`). The run
 * never leaves `validated`/`needs_review`: posting is row 12, owner-gated on
 * `ADR-0008`. Signed out → 401; a malformed id → 400; an unknown or foreign run
 * → 404.
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
    const detail = await getImportRun(store, { organizationId, importRunId: id });
    if (detail === undefined) {
      return jsonError(404);
    }

    return jsonOk({
      run: detail.run,
      rows: toStagingRowRows(detail.rows),
      issues: detail.issues,
      conflicts: detail.conflicts,
      dispositions: detail.dispositions,
    });
  });
}
