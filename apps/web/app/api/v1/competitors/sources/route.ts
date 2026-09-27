import {
  createPostgresCompetitorStore,
  listCompetitorSources,
  registerCompetitorSource,
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
  COMPETITOR_READ_ROLES,
  canManageCompetitorTerms,
  canWriteCompetitors,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "../access";
import {
  parseCompetitorSourceListQuery,
  parseRegisterCompetitorSourceBody,
  toCompetitorSourceRow,
  toCompetitorSourceRows,
} from "../competitor-rows";
import { competitorLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The competitor-source register for the served organization (`ADR-0010`/
 * `DEC-143`, `COMP-001`).
 *
 * Query: optional `active` (`true`/`false`) and `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, sources }`. Signed out → 401; a role outside
 * `COMPETITOR_READ_ROLES` → 403; a malformed filter → 400. Never returns another
 * organization's sources (`DEC-061`).
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

    const parsed = parseCompetitorSourceListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);
    const sources = await listCompetitorSources(store, {
      organizationId,
      ...(parsed.query.active === undefined ? {} : { active: parsed.query.active }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      sources: toCompetitorSourceRows(organizationId, sources),
    });
  });
}

/**
 * Registers one competitor source (`ADR-0010`/`DEC-143`).
 *
 * The role bar depends on the requested mode, and the body is parsed first so
 * the decision is on the validated mode: a **`manual`** source is a normal
 * competitor write (`COMPETITOR_WRITE_ROLES`); an **`automated`** source requires
 * `COMPETITOR_TERMS_ROLES` (owner/admin), because that registration records the
 * terms approval that enables automation. A `manual` source opens `pending`; no
 * source is ever created `automated` without `terms_status = 'approved'` (the
 * database check is the backstop). A malformed body is a 400; a duplicate URL is
 * a `DomainError` → 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.registerSource, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);

    const parsed = parseRegisterCompetitorSourceBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    const allowed =
      parsed.input.collectionMode === "automated"
        ? canManageCompetitorTerms(access)
        : canWriteCompetitors(access);
    if (!allowed) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let source;
    try {
      source = await registerCompetitorSource(store, {
        organizationId,
        actorId: session.userId,
        competitorName: parsed.input.competitorName,
        competitorId: parsed.input.competitorId,
        sourceType: parsed.input.sourceType,
        urlOrIdentifier: parsed.input.urlOrIdentifier,
        collectionMode: parsed.input.collectionMode,
        rateLimitNote: parsed.input.rateLimitNote,
        activeFrom: parsed.input.activeFrom,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ source: toCompetitorSourceRow(organizationId, source) });
  });
}
