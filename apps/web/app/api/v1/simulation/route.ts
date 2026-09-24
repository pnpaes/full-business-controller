import { createPostgresSimulationStore, simulateScenario } from "@aquarela/application";

import { getDb } from "../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { assertSameOrigin } from "../../../../lib/same-origin";
import { getServerSession } from "../../../../lib/server-session";
import {
  SALES_REPORT_READ_ROLES,
  isReportingAuthorized,
  loadReportingAccess,
} from "../reports/access";

import { checkSimulationThrottle } from "./limiters";
import { parseSimulationBody } from "./simulation-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/simulation` — the what-if simulation (`W6`, `DEC-125`). It
 * re-costs the baseline period's products through the existing cost chain and
 * applies the scenario's deltas, returning the modelled baseline, scenario,
 * deltas, capacity and — prominently — the assumptions, the provenance and the
 * terms it could not model. Read-only: it writes no fact, no table, no schema.
 *
 * POST (not GET) because the scenario is a structured body. Same-origin and
 * session-guarded; the caller must hold a reporting role and, when
 * location-scoped, the scenario's `locationId` must be in their scope. The body
 * is shape-checked here (400); the application re-validates and a `DomainError`
 * maps to 400. Signed out → 401; wrong role / out-of-scope location → 403;
 * throttled → 429.
 */
export async function POST(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const throttled = checkSimulationThrottle(request);
    if (throttled !== undefined) {
      return throttled;
    }

    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    try {
      assertSameOrigin(request);
    } catch {
      return jsonError(403);
    }
    const access = await loadReportingAccess(session.userId);
    if (!isReportingAuthorized(access, SALES_REPORT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseSimulationBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (access.locationIds.length > 0 && !access.locationIds.includes(parsed.scenario.locationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSimulationStore(getDb().db);
    const result = await simulateScenario(store, { organizationId, ...parsed.scenario });
    return jsonOk({ ...result });
  });
}
