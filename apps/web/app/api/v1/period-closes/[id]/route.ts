import { createPostgresPeriodCloseStore, findPeriodClose } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isPeriodCloseAuthorized, loadPeriodCloseAccess, PERIOD_CLOSE_READ_ROLES } from "../access";
import { isUuid, toPeriodCloseRow } from "../period-close-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One close by id (`REC-003`, `DEC-027`, row 13a). Signed out → 401; a role
 * outside the close read set → 403; a non-UUID id → 400; an unknown or
 * cross-organization id → 404. A location-scoped caller must hold the close's
 * `scopeId` location (403 otherwise) — the scope is only known after the read,
 * so the read is organization-scoped (`DEC-061`) before the scope check.
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
    const access = await loadPeriodCloseAccess(session.userId);
    if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresPeriodCloseStore(getDb().db);
    const close = await findPeriodClose(store, { organizationId, periodCloseId: id });
    if (close === undefined) {
      return jsonError(404);
    }
    if (
      close.scopeType === "location" &&
      !isPeriodCloseAuthorized(access, PERIOD_CLOSE_READ_ROLES, close.scopeId)
    ) {
      return jsonError(403);
    }

    return jsonOk({ periodClose: toPeriodCloseRow(organizationId, close) });
  });
}
