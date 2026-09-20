import { createPostgresWasteStore, getWasteEvent } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { loadWasteRefs } from "../refs";
import { toWasteEventRows } from "../waste-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One waste event for the served organization (`WASTE-001`). Response:
 * `{ ok: true, row }`. Signed out → 401; a malformed id → 400; a valid but
 * unknown org-scoped id → 404 (never another organization's event).
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
    const wasteEventId = id.trim();
    if (!UUID.test(wasteEventId)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWasteStore(getDb().db);
    const event = await getWasteEvent(store, { organizationId, wasteEventId });
    if (event === undefined) {
      return jsonError(404);
    }

    const refs = await loadWasteRefs(store, [event]);
    return jsonOk({ row: toWasteEventRows(organizationId, [event], refs)[0] });
  });
}
