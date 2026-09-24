import {
  createPostgresCompetitorStore,
  listCompetitorObservations,
  recordCompetitorObservation,
  type CompetitorObservationStatusFilter,
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
  COMPETITOR_WRITE_ROLES,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "../access";
import {
  parseObservationListQuery,
  parseRecordObservationBody,
  toObservationRow,
  toObservationRows,
} from "../competitor-rows";
import { competitorLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The competitor observation register for the served organization (`DEC-126`).
 *
 * Query: optional `competitorId`, `status` (`pending`/`reviewed`/`rejected`/
 * `all`), `from`/`to` (ISO instants, half-open `[from, to)`) and `limit`/`offset`.
 * **No `status` defaults to `reviewed`** — the intelligence read never returns a
 * pending observation unless the caller asks for one explicitly. Response:
 * `{ ok: true, limit, offset, observations }`. Signed out → 401; a role outside
 * `COMPETITOR_READ_ROLES` → 403; a malformed filter → 400. Never returns another
 * organization's observations (`DEC-061`).
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

    const parsed = parseObservationListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);
    const observations = await listCompetitorObservations(store, {
      organizationId,
      ...(parsed.query.competitorId === undefined
        ? {}
        : { competitorId: parsed.query.competitorId }),
      ...(parsed.query.status === undefined
        ? {}
        : { status: parsed.query.status as CompetitorObservationStatusFilter }),
      ...(parsed.query.from === undefined ? {} : { from: parsed.query.from }),
      ...(parsed.query.to === undefined ? {} : { to: parsed.query.to }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      observations: toObservationRows(organizationId, observations),
    });
  });
}

/**
 * Records one competitor observation (`DEC-126`) — a write action, so
 * `COMPETITOR_WRITE_ROLES`. It **always opens `pending`**: capture is not a
 * review, so it cannot be read as intelligence until `reviewCompetitorObservation`
 * decides it. A malformed body is a 400 from the parser; a `DomainError` (a
 * foreign-competitor or a negative price) is a 400 with its message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.recordObservation, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseRecordObservationBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let observation;
    try {
      observation = await recordCompetitorObservation(store, {
        organizationId,
        actorId: session.userId,
        competitorId: parsed.input.competitorId,
        observedAt: parsed.input.observedAt,
        source: parsed.input.source,
        sourceUrl: parsed.input.sourceUrl,
        itemId: parsed.input.itemId,
        externalName: parsed.input.externalName,
        price: parsed.input.price,
        currency: parsed.input.currency,
        offerNotes: parsed.input.offerNotes,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ observation: toObservationRow(organizationId, observation) });
  });
}
