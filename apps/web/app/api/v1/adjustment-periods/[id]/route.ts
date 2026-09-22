import { createPostgresAdjustmentPeriodStore, findAdjustmentPeriod } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  isAdjustmentPeriodAuthorized,
  loadAdjustmentPeriodAccess,
  ADJUSTMENT_PERIOD_READ_ROLES,
} from "../access";
import { isUuid, toAdjustmentPeriodRow } from "../adjustment-period-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One adjustment period by id (`REC-006`, `DEC-027`, row 13b). Signed out → 401;
 * a role outside the adjustment-period read set → 403; a non-UUID id → 400; an
 * unknown or cross-organization id → 404. The read is organization-scoped
 * (`DEC-061`), so another tenant's id is indistinguishable from a missing one.
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
    const access = await loadAdjustmentPeriodAccess(session.userId);
    if (!isAdjustmentPeriodAuthorized(access, ADJUSTMENT_PERIOD_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAdjustmentPeriodStore(getDb().db);
    const period = await findAdjustmentPeriod(store, { organizationId, adjustmentPeriodId: id });
    if (period === undefined) {
      return jsonError(404);
    }

    return jsonOk({ adjustmentPeriod: toAdjustmentPeriodRow(organizationId, period) });
  });
}
