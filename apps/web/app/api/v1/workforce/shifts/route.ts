import { createPostgresSchedulingStore, createShift, listShifts } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  SHIFT_READ_ROLES,
  SHIFT_WRITE_ROLES,
} from "../access";
import { shiftLimiters } from "../limiters";
import {
  parseCreateShiftBody,
  parseShiftListQuery,
  toShiftRow,
  toShiftRows,
} from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The shift rota for the served organization (`WF-002`, `DEC-037`), ordered by
 * `startsAt` then id.
 *
 * Query: optional `locationId` (UUID), `state` (one of `SHIFT_STATES`),
 * `from`/`to` (inclusive ISO-instant bounds on `startsAt`) and `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the read set (owner / general_manager / location_manager / kitchen /
 * front_of_house / finance / admin — `analyst` and `purchasing` have no access)
 * → 403; a malformed filter → 400. Never returns another organization's shifts
 * (`DEC-061`).
 *
 * Location scope: an explicit `locationId` outside the caller's scope is a 403,
 * one inside it is passed through, and with no filter a single-location caller
 * is constrained in the query while a multi-location caller is filtered in
 * memory (the store filter takes one location, so that page may be short of
 * `limit` — the recorded ceiling, mirroring `hms/incidents/route.ts:59-84`). A
 * caller with no location scope sees the whole organization.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseShiftListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const scope = access.locationIds;
    if (
      scope.length > 0 &&
      parsed.query.locationId !== undefined &&
      !scope.includes(parsed.query.locationId)
    ) {
      return jsonError(403);
    }
    const locationId =
      scope.length === 1 && parsed.query.locationId === undefined
        ? scope[0]
        : parsed.query.locationId;

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);
    const shifts = await listShifts(store, {
      organizationId,
      ...(locationId === undefined ? {} : { locationId }),
      ...(parsed.query.state === undefined ? {} : { state: parsed.query.state }),
      ...(parsed.query.from === undefined ? {} : { from: parsed.query.from }),
      ...(parsed.query.to === undefined ? {} : { to: parsed.query.to }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    // Fail-closed: a scoped caller never sees a shift at another location.
    const visible =
      scope.length > 0 ? shifts.filter((shift) => scope.includes(shift.locationId)) : shifts;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toShiftRows(organizationId, visible),
    });
  });
}

/**
 * Plans one shift (`WF-002`, `DEC-037`). The actor is the session user, the
 * organization the served tenant, and a new shift starts `open`. Writing a
 * shift is limited to owner / general_manager / location_manager / admin
 * (kitchen / front_of_house / finance may read but not plan).
 *
 * The body carries `locationId`, `startsAt`, `endsAt` and optional
 * `roleCode`/`breakMinutes`. A malformed body (bad location UUID, a non-instant
 * window, a fractional/negative break) is a 400 from the parser, as is a command
 * rejection (`endsAt` not after `startsAt`). A location-scoped caller may only
 * plan a shift at a location in their scope (403 otherwise) — the body's
 * `locationId` is passed to the role check.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.createShift, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);

    const parsed = parseCreateShiftBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (!isWorkforceAuthorized(access, SHIFT_WRITE_ROLES, parsed.input.locationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);

    let shift;
    try {
      shift = await createShift(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        positionId: parsed.input.positionId,
        roleCode: parsed.input.roleCode,
        startsAt: parsed.input.startsAt,
        endsAt: parsed.input.endsAt,
        ...(parsed.input.breakMinutes === undefined
          ? {}
          : { breakMinutes: parsed.input.breakMinutes }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ shift: toShiftRow(organizationId, shift) });
  });
}
