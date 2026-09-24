import { createPostgresMasterDataStore, registerUnitConversion } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";

import { productLimiters } from "../limiters";

import { parseRegisterUnitConversionBody } from "./unit-conversion-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registers one org-wide (global) unit conversion (`registerUnitConversion`,
 * FND-003): 1 `fromUnitCode` = `factor` × `toUnitCode`, effective from now.
 * Item-scoped conversions stay on the item detail screen. Signed out → 401; a
 * malformed body → 400; a command rejection (unknown unit, duplicate pair,
 * non-positive factor) → 400 with its message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, productLimiters.registerUnitConversion, async () => {
    const { session } = await requireSession(request);

    const body = await readJsonObject(request);
    const parsed = parseRegisterUnitConversionBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);

    try {
      const result = await registerUnitConversion(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.input,
      });
      return jsonOk({ conversionId: result.conversionId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
