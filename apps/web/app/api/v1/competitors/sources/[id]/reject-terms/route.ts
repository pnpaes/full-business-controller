import { createPostgresCompetitorStore, rejectCompetitorSourceTerms } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";

import {
  COMPETITOR_TERMS_ROLES,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "../../../access";
import { isUuid, toCompetitorSourceRow } from "../../../competitor-rows";
import { competitorLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rejects one competitor source's terms (`ADR-0010`/`DEC-143`), owner/admin only
 * (`COMPETITOR_TERMS_ROLES`). Rejection is refused for an `automated` source
 * (`DomainError` → 400): automation requires approved terms, so the way to stop
 * it is `deactivate`. The schema has no free-text reason field, so the decision
 * records the status, the actor and the instant only. A non-UUID id is a 400; a
 * missing or cross-organization source is a 404.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.decideSourceTerms, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_TERMS_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let source;
    try {
      source = await rejectCompetitorSourceTerms(store, {
        organizationId,
        actorId: session.userId,
        sourceId: id,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return jsonError(404);
      }
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ source: toCompetitorSourceRow(organizationId, source) });
  });
}
