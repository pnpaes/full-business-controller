import { createPostgresHmsStore, listEquipment, registerEquipment } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_EQUIPMENT_READ_ROLES,
  HMS_EQUIPMENT_WRITE_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../access";
import {
  parseCreateEquipmentBody,
  parseEquipmentListQuery,
  toEquipmentRows,
} from "../equipment-rows";
import { hmsLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The equipment register for the served organization (`HMS-006`, `DEC-092`),
 * ordered by `code` then id.
 *
 * Query: optional `locationId` (UUID), `kind`, `active` (`true`/`false`), plus
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a role outside the read set (owner / general_manager / location_manager /
 * kitchen / front_of_house / admin / analyst — `purchasing`/`finance` have no
 * access, `DEC-097`) → 403; a malformed filter → 400. Never returns another
 * organization's equipment (`DEC-061`).
 *
 * Equipment carries `location_id`, so location scope mirrors the incident routes
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
    if (!isHmsAuthorized(access, HMS_EQUIPMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseEquipmentListQuery(new URL(request.url).searchParams);
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
    const equipment = await listEquipment(store, {
      organizationId,
      ...(locationId === undefined ? {} : { locationId }),
      ...(parsed.query.kind === undefined ? {} : { kind: parsed.query.kind }),
      ...(parsed.query.active === undefined ? {} : { active: parsed.query.active }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });
    const visible =
      scope.length > 0 ? equipment.filter((item) => scope.includes(item.locationId)) : equipment;

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toEquipmentRows(organizationId, visible),
    });
  });
}

/**
 * Registers one equipment row (`HMS-006`, `DEC-092`). The actor is the session
 * user, the organization the served tenant and the row active by default.
 * Registering is a managed write, so only owner / general_manager /
 * location_manager / admin may do it (`DEC-097`); kitchen/front_of_house may read
 * the register but not write it, `analyst` may read but never write, and
 * `purchasing`/`finance` have no access.
 *
 * The body carries `locationId`, the register `code`, `name`, free-text `kind`
 * and optional `serialNo`/`installedAt`/`warrantyUntil`/`active`. A
 * `YYYY-MM-DD` in a date field is calendar-checked, so a malformed day is a 400
 * before the store; a command rejection (blank `code`/`name`/`kind`, a duplicate
 * code) is also a 400. A location-scoped caller may only register equipment at a
 * location in their scope (403 otherwise).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.registerEquipment, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);

    const parsed = parseCreateEquipmentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    if (!isHmsAuthorized(access, HMS_EQUIPMENT_WRITE_ROLES, parsed.input.locationId)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let equipment;
    try {
      equipment = await registerEquipment(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        code: parsed.input.code,
        name: parsed.input.name,
        kind: parsed.input.kind,
        serialNo: parsed.input.serialNo,
        installedAt: parsed.input.installedAt,
        warrantyUntil: parsed.input.warrantyUntil,
        ...(parsed.input.active === undefined ? {} : { active: parsed.input.active }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ equipmentId: equipment.id, active: equipment.active });
  });
}
