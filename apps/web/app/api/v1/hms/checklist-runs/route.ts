import {
  createPostgresHmsStore,
  findChecklistTemplate,
  listChecklistRuns,
  recordChecklistRun,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_CHECKLIST_RUN_READ_ROLES,
  HMS_CHECKLIST_RUN_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../access";
import {
  parseChecklistRunListQuery,
  parseRecordChecklistRunBody,
  toChecklistRunRows,
} from "../checklist-rows";
import { hmsLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checklist runs for the served organization (`HMS-005`, `DEC-091`, `DEC-096`),
 * newest `runAt` first.
 *
 * Query: optional `templateId`/`locationId` (UUID) and `status`, plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside the read set (owner / general_manager / location_manager /
 * kitchen / front_of_house / admin / analyst — `purchasing`/`finance` have no
 * access, `DEC-096`) → 403; a malformed filter → 400. Never returns another
 * organization's runs (`DEC-061`).
 *
 * A run carries `location_id`, so location scope mirrors the incident routes
 * (`incidents/route.ts:59-84`): an explicit `locationId` outside the caller's
 * scope is a 403, one inside it is passed through, and with no filter a
 * single-location caller is constrained in the query while a multi-location
 * caller is filtered in memory (the store filter takes one location, so that
 * page may be short of `limit`). A caller with no location scope sees the whole
 * organization.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseChecklistRunListQuery(new URL(request.url).searchParams);
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
    const store = createPostgresHmsStore(getDb().db);
    const runs = await listChecklistRuns(store, {
      organizationId,
      ...(parsed.query.templateId === undefined ? {} : { templateId: parsed.query.templateId }),
      ...(locationId === undefined ? {} : { locationId }),
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    const visible = scope.length > 0 ? runs.filter((run) => scope.includes(run.locationId)) : runs;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toChecklistRunRows(organizationId, visible),
    });
  });
}

/**
 * Records one checklist run (`HMS-005`, `DEC-091`). The actor and `performedBy`
 * are the session user (`created_by` is set from the actor by the command), the
 * organization is the served tenant and a new run starts `in_progress` unless the
 * body names another `status`. Recording is operational — owner / general_manager
 * / location_manager / kitchen / front_of_house / admin may do it (`DEC-096`);
 * `analyst` may read but not record, and `purchasing`/`finance` have no access.
 *
 * The body carries `templateId`, `locationId`, `runAt`, the `results` array and
 * an optional `status`/`notes`. The referenced template is resolved
 * organization-scoped first: a missing or cross-organization `templateId` is a
 * 404, so an id from another tenant cannot leak (`DEC-061`). A run carries
 * `location_id`, so a location-scoped caller may only record a run at a location
 * in their scope (403). A bad vocabulary value, a non-array `results`/bad item
 * `outcome` or a malformed body is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.recordChecklistRun, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);

    const parsed = parseRecordChecklistRunBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    const template = await findChecklistTemplate(store, {
      organizationId,
      templateId: parsed.input.templateId,
    });
    if (template === undefined) {
      return jsonError(404);
    }

    if (!isHmsAuthorized(access, HMS_CHECKLIST_RUN_RECORD_ROLES, parsed.input.locationId)) {
      return jsonError(403);
    }

    let run;
    try {
      run = await recordChecklistRun(store, {
        organizationId,
        actorId: session.userId,
        performedBy: session.userId,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ runId: run.id, status: run.status });
  });
}
