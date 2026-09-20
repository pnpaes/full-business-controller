import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  listLaborRates,
  registerLaborRate,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { loadCostingRefs, toLaborRateRows } from "../costing-views";
import { readJsonObject, readOptionalString, readRequiredString } from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only labour rates (COST-004), newest effective window first. */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const rates = await listLaborRates(store, { organizationId });
    const refs = await loadCostingRefs(store, {
      costCenterIds: rates.map((rate) => rate.costCenterId),
    });

    return jsonOk({ rows: toLaborRateRows(organizationId, rates, refs) });
  });
}

/**
 * Registers one labour rate through the application command (COST-004): the
 * statutory percentages are optional, the loaded hourly rate is derived by the
 * domain, and the organization/actor come from the session.
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
    const roleCode = readRequiredString(body, "roleCode");
    const baseHourlyRate = readRequiredString(body, "baseHourlyRate");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (
      costCenterId === undefined ||
      roleCode === undefined ||
      baseHourlyRate === undefined ||
      effectiveFrom === undefined
    ) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingStore(getDb().db);
    const feriepengerPct = readOptionalString(body, "feriepengerPct");
    const employerContributionPct = readOptionalString(body, "employerContributionPct");
    const pensionPct = readOptionalString(body, "pensionPct");
    const productiveHoursPct = readOptionalString(body, "productiveHoursPct");
    try {
      const result = await registerLaborRate(store, {
        organizationId,
        actorId: session.userId,
        costCenterId,
        roleCode,
        baseHourlyRate,
        ...(feriepengerPct === undefined ? {} : { feriepengerPct }),
        ...(employerContributionPct === undefined ? {} : { employerContributionPct }),
        ...(pensionPct === undefined ? {} : { pensionPct }),
        ...(productiveHoursPct === undefined ? {} : { productiveHoursPct }),
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
      });
      return jsonOk({
        laborRateId: result.laborRateId,
        loadedHourlyRate: result.loadedHourlyRate,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }
  });
}
