import { createPostgresMasterDataStore, listUnits } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  ADMIN_UNIT_READ_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../access";
import { parseUnitsQuery, toUnitRow } from "../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unit register for the served organization (FND-003), ordered by `code`.
 *
 * Query: optional `dimension` (`mass`/`volume`/`count`/`time`/`package`) plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside `ADMIN_UNIT_READ_ROLES` (owner / general_manager /
 * location_manager / kitchen / purchasing / finance / admin / analyst) → 403; a
 * malformed filter or page → 400. Never returns another organization's units
 * (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_UNIT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseUnitsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);

    let rows;
    try {
      rows = await listUnits(store, {
        organizationId,
        ...(parsed.query.dimension === undefined ? {} : { dimension: parsed.query.dimension }),
        limit: parsed.query.limit,
        offset: parsed.query.offset,
      });
    } catch (error) {
      // `listUnits` is the authority for the page bounds.
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: rows.map(toUnitRow),
    });
  });
}
