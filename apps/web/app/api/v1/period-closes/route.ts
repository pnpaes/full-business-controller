import {
  beginPeriodClose,
  createPostgresPeriodCloseStore,
  listPeriodCloses,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import {
  isPeriodCloseAuthorized,
  loadPeriodCloseAccess,
  PERIOD_CLOSE_COMPANY_WRITE_ROLES,
  PERIOD_CLOSE_READ_ROLES,
  PERIOD_CLOSE_WRITE_ROLES,
} from "./access";
import { periodCloseLimiters } from "./limiters";
import {
  parseBeginPeriodCloseBody,
  parseListPeriodClosesQuery,
  toPeriodCloseRow,
  toPeriodCloseRows,
} from "./period-close-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The close register for the served organization (`REC-003`, `DEC-027`, row
 * 13a), newest period first.
 *
 * Query: optional `scopeType` (`location`/`company`), `scopeId`, `status` (one of
 * `period_close_status`) and `from`/`to` (`YYYY-MM-DD`, inclusive bounds on
 * `periodStart`), plus `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, periodCloses }`. Signed out → 401; a role outside
 * the close read set → 403; a malformed filter or paging value → 400. Never
 * returns another organization's data (`DEC-061`).
 *
 * **Provisional** (`DEC-105`): a location-scoped caller is **not** filtered to
 * their own locations in this list — the recorded systemic location-scope gap.
 * The `[id]` read, begin and lock routes do enforce the location scope.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadPeriodCloseAccess(session.userId);
    if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseListPeriodClosesQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresPeriodCloseStore(getDb().db);
    const closes = await listPeriodCloses(store, {
      organizationId,
      ...(parsed.query.scopeType === undefined ? {} : { scopeType: parsed.query.scopeType }),
      ...(parsed.query.scopeId === undefined ? {} : { scopeId: parsed.query.scopeId }),
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(parsed.query.from === undefined ? {} : { from: parsed.query.from }),
      ...(parsed.query.to === undefined ? {} : { to: parsed.query.to }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      periodCloses: toPeriodCloseRows(organizationId, closes),
    });
  });
}

/**
 * Begins (or re-begins) a close (`REC-003`, `DEC-027`). The actor is the session
 * user and the organization the served tenant.
 *
 * The body carries `scopeType` (`location`/`company`), `scopeId` (a location id
 * or the organization id), `periodStart` (`YYYY-MM-DD`) and an optional
 * `checklist`; a malformed body is a 400. Beginning requires the write roles, a
 * `company` scope additionally the company-write roles, and a location-scoped
 * caller must hold the `scopeId` location (403 otherwise). A `begin` while the
 * period is `locked` is a typed `DomainError` → 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, periodCloseLimiters.beginPeriodClose, async () => {
    const { session } = await requireSession(request);
    const access = await loadPeriodCloseAccess(session.userId);
    if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseBeginPeriodCloseBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const { scopeType, scopeId } = parsed.input;
    if (
      !isPeriodCloseAuthorized(
        access,
        PERIOD_CLOSE_WRITE_ROLES,
        scopeType === "location" ? scopeId : undefined,
      )
    ) {
      return jsonError(403);
    }
    if (
      scopeType === "company" &&
      !isPeriodCloseAuthorized(access, PERIOD_CLOSE_COMPANY_WRITE_ROLES)
    ) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresPeriodCloseStore(getDb().db);

    let close;
    try {
      close = await beginPeriodClose(store, {
        organizationId,
        actorId: session.userId,
        scopeType: parsed.input.scopeType,
        scopeId: parsed.input.scopeId,
        periodStart: parsed.input.periodStart,
        checklist: parsed.input.checklist,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ periodClose: toPeriodCloseRow(organizationId, close) });
  });
}
