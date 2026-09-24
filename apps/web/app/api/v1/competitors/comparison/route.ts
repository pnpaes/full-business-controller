import { compareCompetitorPrices, createPostgresCompetitorStore } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { COMPETITOR_READ_ROLES, isCompetitorAuthorized, loadCompetitorAccess } from "../access";
import { parseComparisonQuery } from "../competitor-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The competitor price comparison for the served organization (`DEC-126`).
 *
 * Query: optional `itemId`/`competitorId`, **required** `from`/`to` (ISO
 * instants, half-open `[from, to)`) and `limit`/`offset`. Each row pairs a
 * **reviewed** observation with our own effective price for the same `item_id`
 * at the observation instant — the competitor price, our price, the basis, the
 * difference, the ratio and the date gap — or reports it as not comparable with
 * a reason. Only reviewed observations are read.
 *
 * Response: `{ ok: true, limit, offset, comparisons }`. Signed out → 401; a role
 * outside `COMPETITOR_READ_ROLES` → 403; a malformed or incomplete filter → 400.
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

    const parsed = parseComparisonQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);
    const comparisons = await compareCompetitorPrices(store, {
      organizationId,
      ...(parsed.query.itemId === undefined ? {} : { itemId: parsed.query.itemId }),
      ...(parsed.query.competitorId === undefined
        ? {}
        : { competitorId: parsed.query.competitorId }),
      from: parsed.query.from,
      to: parsed.query.to,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      comparisons,
    });
  });
}
