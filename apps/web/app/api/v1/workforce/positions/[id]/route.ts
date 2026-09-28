import { createPostgresWorkforceStore, findPosition, updatePosition } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../../access";
import { workforceLimiters } from "../../limiters";
import { isUuid, parseUpdatePositionBody, toPositionRow } from "../../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One position by id (`DEC-151`), organization-scoped (`DEC-061`). */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);
    const position = await findPosition(store, { organizationId, positionId: id });
    if (position === undefined) {
      return jsonError(404);
    }

    return jsonOk({ position: toPositionRow(organizationId, position) });
  });
}

/**
 * Amends one position (`DEC-151`): rename, re-code or set the effective window.
 * **Deactivation is `PATCH { activeTo }`** — there is no delete, so historical
 * shift/employee references keep their meaning. A non-UUID id or malformed body
 * is a 400; a missing or cross-organization position is a 404.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.updatePosition, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdatePositionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    let position;
    try {
      position = await updatePosition(store, {
        organizationId,
        actorId: session.userId,
        positionId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ position: toPositionRow(organizationId, position) });
  });
}
