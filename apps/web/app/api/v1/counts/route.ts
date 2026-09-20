import { createPostgresCountStore, listStockCounts, openStockCount } from "@aquarela/application";
import type { InventoryLocationRecord } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import { parseCountListQuery, parseOpenCountBody, toCountRows } from "./count-rows";
import { countsLimiters } from "./limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Counts for the served organization (`INV-004`, `DEC-017`), newest cutoff first.
 *
 * Query: optional `locationId` (UUID), `status` (count vocabulary), `limit`/
 * `offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a
 * malformed filter → 400. Never returns another organization's counts.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseCountListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);
    const summaries = await listStockCounts(store, { organizationId, ...parsed.query });

    const locationIds = [...new Set(summaries.map((summary) => summary.count.locationId))];
    const locations = await Promise.all(locationIds.map((id) => store.findLocation(id)));
    const locationsById = new Map<string, InventoryLocationRecord>();
    for (const location of locations) {
      if (location !== undefined) {
        locationsById.set(location.id, location);
      }
    }

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toCountRows(organizationId, summaries, locationsById),
    });
  });
}

/**
 * Opens a count over a location (`INV-004`): the header plus one line per
 * `(item, storage_area, lot)` group with ledger history at `cutoff`, each
 * snapshotting its expected quantity. The actor is the session user; the
 * organization is the served tenant. A command rejection (unknown location,
 * malformed cutoff) is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, countsLimiters.open, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseOpenCountBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);

    let result: { stockCountId: string; lineCount: number; replayed: boolean };
    try {
      result = await openStockCount(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        cutoff: parsed.input.cutoff,
        blind: parsed.input.blind,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({
      stockCountId: result.stockCountId,
      lineCount: result.lineCount,
      replayed: result.replayed,
    });
  });
}
