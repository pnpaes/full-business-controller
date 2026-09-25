import { createPostgresForecastStore, recordForecastOverride } from "@aquarela/application";

import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";
import { loadReportingAccess } from "../../../reports/access";
import { parseForecastOverrideBody } from "../../analytics-rows";
import { isForecastWriteAuthorized } from "../../access";
import { analyticsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Appends one advisory `forecast_override` (`DEC-011`, `DEC-138`): a human,
 * reasoned annotation of a projected day bucket. It is **append-only** (a
 * correction is a new override, never an edit — the `0070` trigger rejects
 * UPDATE/DELETE) and **never auto-applied**; the reason is mandatory, so an
 * unexplained override is refused.
 *
 * Guard order: same-origin + throttle (`withMutationGuards`), then session →
 * write role (`FORECAST_WRITE_ROLES`, owner / general_manager / admin) → body
 * parse. Body: required `metric`, `period` (`YYYY-MM-DD`) and `reason`; optional
 * `grain` (default `day_location`), `snapshotId`, `locationId`/`channelId`.
 * Response `{ ok: true, forecastOverrideId }`. Signed out → 401; a role outside
 * the write set → 403; a malformed body or a `DomainError` → 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, analyticsLimiters.recordForecastOverride, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadReportingAccess(session.userId);
    if (!isForecastWriteAuthorized(access)) {
      return jsonError(403);
    }

    const parsed = parseForecastOverrideBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresForecastStore(getDb().db);
    const result = await recordForecastOverride(store, {
      organizationId,
      actorId: session.userId,
      ...parsed.fields,
    });

    return jsonOk({ forecastOverrideId: result.forecastOverrideId });
  });
}
