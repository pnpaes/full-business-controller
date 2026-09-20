import {
  createPostgresInventoryStore,
  listStorageAreas,
  registerStorageArea,
} from "@aquarela/application";
import type { InventoryLocationRecord } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";
import { inventoryLimiters } from "../limiters";
import {
  parseRegisterStorageAreaBody,
  parseStorageAreaQuery,
  toStorageAreaRows,
} from "./storage-area-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Storage areas for the served organization (DATA_DICTIONARY §4).
 *
 * Query: optional `locationId`. Response: `{ ok: true, rows }`. Signed out → 401;
 * a malformed filter → 400. Never returns another organization's rows.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const parsed = parseStorageAreaQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);
    const areas = await listStorageAreas(store, {
      organizationId,
      ...(parsed.locationId === undefined ? {} : { locationId: parsed.locationId }),
    });

    const locationIds = [...new Set(areas.map((area) => area.locationId))];
    const locations = await Promise.all(locationIds.map((id) => store.findLocation(id)));
    const byId = new Map<string, InventoryLocationRecord>();
    for (const location of locations) {
      if (location !== undefined) {
        byId.set(location.id, location);
      }
    }

    return jsonOk({ rows: toStorageAreaRows(organizationId, areas, byId) });
  });
}

/**
 * Registers one storage area. `registerStorageArea` enforces the per-location
 * code uniqueness and the `isTransit`-only-on-`virtual_transit` rule; the route
 * validates the vocabulary and text shapes and maps a command rejection to 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, inventoryLimiters.registerStorageArea, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseRegisterStorageAreaBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresInventoryStore(getDb().db);

    let created: { storageAreaId: string };
    try {
      created = await registerStorageArea(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        code: parsed.input.code,
        name: parsed.input.name,
        kind: parsed.input.kind,
        isTransit: parsed.input.isTransit,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({ storageAreaId: created.storageAreaId });
  });
}
