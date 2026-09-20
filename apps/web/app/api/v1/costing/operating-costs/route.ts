import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  listOperatingCosts,
  registerOperatingCost,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { loadCostingRefs, toOperatingCostRows } from "../costing-views";
import { readJsonObject, readOptionalString, readRequiredString } from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only operating costs (COST-003), newest effective window first. */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const costs = await listOperatingCosts(store, { organizationId });
    const refs = await loadCostingRefs(store, {
      costCenterIds: costs.map((cost) => cost.costCenterId),
      locationIds: costs.flatMap((cost) => (cost.locationId === null ? [] : [cost.locationId])),
    });

    return jsonOk({ rows: toOperatingCostRows(organizationId, costs, refs) });
  });
}

/**
 * Registers one operating cost through the application command (COST-003). The
 * organization and actor come from the session, never the body; the command is
 * the single validator, and a `DomainError` maps to 400.
 */
export async function POST(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }
    const costCenterId = readRequiredString(body, "costCenterId");
    const amount = readRequiredString(body, "amount");
    const recurrence = readRequiredString(body, "recurrence");
    const behavior = readRequiredString(body, "behavior");
    const taxBasis = readRequiredString(body, "taxBasis");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (
      costCenterId === undefined ||
      amount === undefined ||
      recurrence === undefined ||
      behavior === undefined ||
      taxBasis === undefined ||
      effectiveFrom === undefined
    ) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingStore(getDb().db);
    const currency = readOptionalString(body, "currency");
    try {
      const result = await registerOperatingCost(store, {
        organizationId,
        actorId: session.userId,
        costCenterId,
        locationId: readOptionalString(body, "locationId") ?? null,
        amount,
        ...(currency === undefined ? {} : { currency }),
        recurrence,
        behavior,
        taxBasis,
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
        vendor: readOptionalString(body, "vendor") ?? null,
        evidenceFileId: readOptionalString(body, "evidenceFileId") ?? null,
      });
      return jsonOk({ operatingCostId: result.operatingCostId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
