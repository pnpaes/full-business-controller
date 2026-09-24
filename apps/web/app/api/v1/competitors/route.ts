import {
  createPostgresCompetitorStore,
  listCompetitors,
  registerCompetitor,
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
  COMPETITOR_READ_ROLES,
  COMPETITOR_WRITE_ROLES,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "./access";
import {
  parseCompetitorListQuery,
  parseCreateCompetitorBody,
  toCompetitorRow,
  toCompetitorRows,
} from "./competitor-rows";
import { competitorLimiters } from "./limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The competitor register for the served organization (`DEC-126`).
 *
 * Query: optional `limit`/`offset`. Response: `{ ok: true, limit, offset,
 * competitors }`. Signed out → 401; a role outside `COMPETITOR_READ_ROLES` → 403;
 * a malformed filter → 400. Never returns another organization's competitors
 * (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCompetitorListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);
    const competitors = await listCompetitors(store, {
      organizationId,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      competitors: toCompetitorRows(organizationId, competitors),
    });
  });
}

/**
 * Registers one competitor (`DEC-126`) — a write action, so `COMPETITOR_WRITE_ROLES`
 * (owner / general manager / admin / location manager). **Idempotent on
 * `(organization, name)`**: registering an existing name returns the existing
 * row unchanged. The actor is the session user and the organization the served
 * tenant. A malformed body (blank `name`) is a 400 from the parser; a
 * `DomainError` from the command is a 400 with its message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.registerCompetitor, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreateCompetitorBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let competitor;
    try {
      competitor = await registerCompetitor(store, {
        organizationId,
        actorId: session.userId,
        name: parsed.input.name,
        notes: parsed.input.notes,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ competitor: toCompetitorRow(organizationId, competitor) });
  });
}
