import { createPostgresMasterDataStore, registerSupplier } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";

import { purchasingLimiters } from "../limiters";

import { parseRegisterSupplierBody } from "./supplier-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registers one known supplier (`registerSupplier`, DEC-047). Idempotent on the
 * natural key `(organization_id, code)`: a repeat submit returns the existing
 * supplier with `created: false`. The currency defaults to the organization's
 * currency when omitted. Signed out → 401; a malformed body → 400; a command
 * rejection → 400 with its message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, purchasingLimiters.registerSupplier, async () => {
    const { session } = await requireSession(request);

    const body = await readJsonObject(request);
    const parsed = parseRegisterSupplierBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresMasterDataStore(getDb().db);

    try {
      const result = await registerSupplier(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.input,
      });
      return jsonOk({ supplierId: result.supplierId, created: result.created });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
