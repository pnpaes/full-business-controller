import { createPostgresCompetitorStore, deactivateCompetitorSource } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import {
  COMPETITOR_WRITE_ROLES,
  isCompetitorAuthorized,
  loadCompetitorAccess,
} from "../../../access";
import {
  isUuid,
  parseDeactivateCompetitorSourceBody,
  toCompetitorSourceRow,
} from "../../../competitor-rows";
import { competitorLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ends one competitor source's active window (`ADR-0010`/`DEC-143`) by setting
 * `active_to` — a range edit, not a delete. A source-lifecycle write, so
 * `COMPETITOR_WRITE_ROLES` (the terms bar is only for approves/rejects). Body:
 * `{ activeTo }` (ISO date, strictly after `active_from`). A non-UUID id or a
 * malformed body is a 400; a missing or cross-organization source is a 404; an
 * out-of-range `activeTo` is a `DomainError` → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.deactivateSource, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseDeactivateCompetitorSourceBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let source;
    try {
      source = await deactivateCompetitorSource(store, {
        organizationId,
        actorId: session.userId,
        sourceId: id,
        activeTo: parsed.input.activeTo,
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
