import {
  createPostgresWorkforceStore,
  listPositions,
  registerPosition,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

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
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../access";
import { workforceLimiters } from "../limiters";
import {
  parseCreatePositionBody,
  parsePositionListQuery,
  toPositionRow,
  toPositionRows,
} from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The position catalogue for the served organization (`DEC-151`), ordered by
 * name then id. Query: optional `active` (`true`/`false`) and `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside
 * the workforce read set → 403; a malformed filter → 400. Never returns another
 * organization's positions (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parsePositionListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);
    const positions = await listPositions(store, {
      organizationId,
      ...(parsed.query.active === undefined ? {} : { active: parsed.query.active }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toPositionRows(organizationId, positions),
    });
  });
}

/**
 * Registers one position (`DEC-151`). Position management uses the workforce
 * write roles; the actor is the session user and the organization the served
 * tenant. The body carries `code`, `name`, `activeFrom` and optional `activeTo`;
 * a duplicate code (case-insensitive) or a malformed body is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, workforceLimiters.registerPosition, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreatePositionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWorkforceStore(getDb().db);

    let position;
    try {
      position = await registerPosition(store, {
        organizationId,
        actorId: session.userId,
        code: parsed.input.code,
        name: parsed.input.name,
        activeFrom: parsed.input.activeFrom,
        activeTo: parsed.input.activeTo,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ position: toPositionRow(organizationId, position) });
  });
}
