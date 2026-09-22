import {
  createPostgresAdjustmentPeriodStore,
  listAdjustmentPeriods,
  openAdjustmentPeriod,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import {
  isAdjustmentPeriodAuthorized,
  loadAdjustmentPeriodAccess,
  ADJUSTMENT_PERIOD_READ_ROLES,
  ADJUSTMENT_PERIOD_WRITE_ROLES,
} from "./access";
import {
  parseListAdjustmentPeriodsQuery,
  parseOpenAdjustmentPeriodBody,
  toAdjustmentPeriodRow,
  toAdjustmentPeriodRows,
} from "./adjustment-period-rows";
import { adjustmentPeriodLimiters } from "./limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The adjustment-period register for the served organization (`REC-006`,
 * `DEC-027`, row 13b), newest window first.
 *
 * Query: optional `status` (one of `adjustment_period_status`) and `from`/`to`
 * (`YYYY-MM-DD`, inclusive bounds on `openedFrom`), plus `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, adjustmentPeriods }`. Signed out → 401;
 * a role outside the adjustment-period read set → 403; a malformed filter or
 * paging value → 400. Never returns another organization's data (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdjustmentPeriodAccess(session.userId);
    if (!isAdjustmentPeriodAuthorized(access, ADJUSTMENT_PERIOD_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseListAdjustmentPeriodsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAdjustmentPeriodStore(getDb().db);
    const periods = await listAdjustmentPeriods(store, {
      organizationId,
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(parsed.query.from === undefined ? {} : { from: parsed.query.from }),
      ...(parsed.query.to === undefined ? {} : { to: parsed.query.to }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      adjustmentPeriods: toAdjustmentPeriodRows(organizationId, periods),
    });
  });
}

/**
 * Opens an adjustment period (`REC-006`, `DEC-027`). The actor is the session
 * user and the organization the served tenant.
 *
 * The body carries `openedFrom`/`openedTo` (`YYYY-MM-DD`) and a required
 * `reason`; a malformed body is a 400. Opening requires
 * `ADJUSTMENT_PERIOD_WRITE_ROLES`. A second open period for the organization is a
 * typed `DomainError` → 400. Approval is single-stage: the session user is
 * recorded as the approver.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, adjustmentPeriodLimiters.openAdjustmentPeriod, async () => {
    const { session } = await requireSession(request);
    const access = await loadAdjustmentPeriodAccess(session.userId);
    if (!isAdjustmentPeriodAuthorized(access, ADJUSTMENT_PERIOD_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseOpenAdjustmentPeriodBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAdjustmentPeriodStore(getDb().db);

    let period;
    try {
      period = await openAdjustmentPeriod(store, {
        organizationId,
        actorId: session.userId,
        openedFrom: parsed.input.openedFrom,
        openedTo: parsed.input.openedTo,
        reason: parsed.input.reason,
      });
    } catch (error) {
      // `openAdjustmentPeriod` only ever throws `DomainError`; there is no
      // `NotFoundError` path (the row is created, not read by id).
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ adjustmentPeriod: toAdjustmentPeriodRow(organizationId, period) });
  });
}
