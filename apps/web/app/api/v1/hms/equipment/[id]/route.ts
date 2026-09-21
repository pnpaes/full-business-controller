import { createPostgresHmsStore, findEquipment, updateEquipment } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  HMS_EQUIPMENT_READ_ROLES,
  HMS_EQUIPMENT_WRITE_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import { isUuid, parseUpdateEquipmentBody, toEquipmentRow } from "../../equipment-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One equipment row by id (`HMS-006`, `DEC-092`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). Equipment carries `location_id`, so for a location-scoped caller
 * the row is resolved org-scoped first — unknown/missing → 404, a row at another
 * location → 403 (`monitoring-points/[id]/readings/route.ts:68-76`).
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
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_EQUIPMENT_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const equipment = await findEquipment(store, { organizationId, equipmentId: id });
    if (equipment === undefined) {
      return jsonError(404);
    }
    if (!isHmsAuthorized(access, HMS_EQUIPMENT_READ_ROLES, equipment.locationId)) {
      return jsonError(403);
    }

    return jsonOk({ equipment: toEquipmentRow(organizationId, equipment) });
  });
}

/**
 * Amends one equipment row (`HMS-006`, `DEC-092`). Amending is the same managed
 * write as registering, so only owner / general_manager / location_manager /
 * admin may do it (`DEC-097`). `code` (the register key) and `location_id` are
 * immutable after creation, so neither is patchable.
 *
 * The body is any subset of `name`, `kind`, `serialNo`, `installedAt`,
 * `warrantyUntil` and `active` (`null` clears an optional field). A malformed
 * body, a malformed calendar day or a non-UUID id is a 400, as is a command
 * rejection (blank name/kind, no fields). An unknown/cross-organization row is a
 * 404; a location-scoped caller may only edit equipment at a location in their
 * scope — the row is resolved org-scoped before the command, so another
 * location's row is a 403.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateEquipment, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_EQUIPMENT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateEquipmentBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    if (access.locationIds.length > 0) {
      const equipment = await findEquipment(store, { organizationId, equipmentId: id });
      if (equipment === undefined) {
        return jsonError(404);
      }
      if (!isHmsAuthorized(access, HMS_EQUIPMENT_WRITE_ROLES, equipment.locationId)) {
        return jsonError(403);
      }
    }

    let equipment;
    try {
      equipment = await updateEquipment(store, {
        organizationId,
        actorId: session.userId,
        equipmentId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ equipment: toEquipmentRow(organizationId, equipment) });
  });
}
