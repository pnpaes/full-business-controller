import {
  createPostgresProductionStore,
  createProductionPlan,
  listProductionPlans,
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

import { productionLimiters } from "../limiters";
import {
  parseCreateProductionPlanBody,
  parseProductionPlanListQuery,
  toProductionPlanRows,
} from "../production-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production plans for the served organization (`PROD-001`), newest production
 * date first.
 *
 * Query: optional `locationId` (UUID), `status` (free text — the plan has no
 * vocabulary authority, open point (f)), `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`. Signed out → 401; a malformed
 * filter → 400. Never returns another organization's plans.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseProductionPlanListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);
    const page = await listProductionPlans(store, { organizationId, ...parsed.query });

    const locationIds = [...new Set(page.plans.map((plan) => plan.locationId))];
    const found = await Promise.all(locationIds.map((id) => store.findLocation(id)));
    const locations = new Map<string, InventoryLocationRecord>();
    for (const location of found) {
      if (location !== undefined) {
        locations.set(location.id, location);
      }
    }

    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toProductionPlanRows(organizationId, page.plans, locations),
    });
  });
}

/**
 * Creates a production-plan header (`PROD-001`). The actor is the session user
 * and the organization the served tenant; a command rejection (unknown
 * location, malformed date) is a 400. A caller-supplied `productionPlanId`
 * makes a replay return the existing plan (`replayed: true`).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, productionLimiters.createPlan, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseCreateProductionPlanBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresProductionStore(getDb().db);

    let result: { productionPlanId: string; status: string; replayed: boolean };
    try {
      result = await createProductionPlan(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        productionDate: parsed.input.productionDate,
        ...(parsed.input.status === null ? {} : { status: parsed.input.status }),
        ...(parsed.input.productionPlanId === null
          ? {}
          : { productionPlanId: parsed.input.productionPlanId }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      productionPlanId: result.productionPlanId,
      status: result.status,
      replayed: result.replayed,
    });
  });
}
