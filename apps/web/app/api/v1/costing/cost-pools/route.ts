import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  listCostPools,
  registerCostPool,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { toCostPoolRows } from "../costing-views";
import { readJsonObject, readOptionalString, readRequiredString } from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only cost pools (COST-007), grouped by code and newest version first. */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const pools = await listCostPools(store, { organizationId });
    return jsonOk({ rows: toCostPoolRows(organizationId, pools) });
  });
}

/** Registers a cost pool (or a new non-overlapping version) via the command (COST-007). */
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
    const code = readRequiredString(body, "code");
    const name = readRequiredString(body, "name");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (code === undefined || name === undefined || effectiveFrom === undefined) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingStore(getDb().db);
    try {
      const result = await registerCostPool(store, {
        organizationId,
        actorId: session.userId,
        code,
        name,
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
      });
      return jsonOk({ costPoolId: result.costPoolId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }
  });
}
