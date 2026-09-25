import { createPostgresTaxStore, supersedeTaxRule } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { getServerSession } from "../../../../../../../lib/server-session";
import { isCostingAuthorized, loadCostingAccess } from "../../../access";
import { isUuid } from "../../../costing-views";
import { readJsonObject, readRequiredString } from "../../../parse";
import { TAX_RULE_WRITE_ROLES } from "../../access";
import { taxRuleLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ends one tax rule by setting its `effective_to` (no other field is editable —
 * a rate change is a new rule, `DEC-003`/`DEC-022`). The organization and actor
 * come from the session, never the body, and a cross-organization id is refused
 * by the command. Response `{ ok: true, taxRuleId, effectiveTo }`. Signed out →
 * 401; a role outside the write set → 403; malformed id/body or a refused
 * supersede → 400.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withMutationGuards(request, taxRuleLimiters.supersedeTaxRule, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, TAX_RULE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }
    const effectiveTo = readRequiredString(body, "effectiveTo");
    if (effectiveTo === undefined) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaxStore(getDb().db);
    try {
      const result = await supersedeTaxRule(store, {
        organizationId,
        actorId: session.userId,
        taxRuleId: id,
        effectiveTo,
      });
      return jsonOk({ taxRuleId: result.taxRuleId, effectiveTo: result.effectiveTo });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
