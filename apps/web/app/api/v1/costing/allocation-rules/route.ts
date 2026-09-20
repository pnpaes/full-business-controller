import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  listAllocationRules,
  registerAllocationRule,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { toAllocationRuleRows } from "../costing-views";
import { readJsonObject, readOptionalString, readRequiredString } from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only allocation rules (COST-007/011) with their pool's code, newest first. */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const rules = await listAllocationRules(store, { organizationId });
    return jsonOk({ rows: toAllocationRuleRows(rules) });
  });
}

/** Registers one allocation rule on a pool via the command (COST-007/011). */
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
    const costPoolId = readRequiredString(body, "costPoolId");
    const driver = readRequiredString(body, "driver");
    const scopeType = readRequiredString(body, "scopeType");
    const denominatorSource = readRequiredString(body, "denominatorSource");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (
      costPoolId === undefined ||
      driver === undefined ||
      scopeType === undefined ||
      denominatorSource === undefined ||
      effectiveFrom === undefined
    ) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingStore(getDb().db);
    const fallbackBehavior = readOptionalString(body, "fallbackBehavior");
    try {
      const result = await registerAllocationRule(store, {
        organizationId,
        actorId: session.userId,
        costPoolId,
        driver,
        scopeType,
        denominatorSource,
        ...(fallbackBehavior === undefined ? {} : { fallbackBehavior }),
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
      });
      return jsonOk({ allocationRuleId: result.allocationRuleId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
