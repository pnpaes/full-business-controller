import {
  createPostgresDataQualityReadStore,
  listDataQualityExceptions,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  ADMIN_DATA_QUALITY_READ_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../access";
import { parseDataQualityQuery, toDataQualityExceptionRow } from "../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Data-quality exception register for the served organization
 * (`07_SECURITY_AND_NFR.md` §7.9, `DEC-080`), newest `detected_at` first.
 *
 * Query: optional `status`, `severity` and `entityType` filters plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside `ADMIN_DATA_QUALITY_READ_ROLES` (owner / general_manager /
 * location_manager / finance / admin / analyst) → 403; a malformed page → 400.
 * Never returns another organization's exceptions (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_DATA_QUALITY_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseDataQualityQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresDataQualityReadStore(getDb().db);

    let rows;
    try {
      rows = await listDataQualityExceptions(store, {
        organizationId,
        ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
        ...(parsed.query.severity === undefined ? {} : { severity: parsed.query.severity }),
        ...(parsed.query.entityType === undefined ? {} : { entityType: parsed.query.entityType }),
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      // `listDataQualityExceptions` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: rows.map(toDataQualityExceptionRow),
    });
  });
}
