import { createPostgresCompetitorStore, reviewCompetitorObservation } from "@aquarela/application";
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
import { isUuid, parseReviewObservationBody, toObservationRow } from "../../../competitor-rows";
import { competitorLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Applies the one-shot review decision to a `pending` observation (`DEC-126`,
 * the `DEC-020` human-review gate): `{ decision: "reviewed" | "rejected" }`. The
 * named reviewer is the session user and the timestamp is the write instant.
 *
 * A write action (`COMPETITOR_WRITE_ROLES`). A non-UUID id or a malformed body
 * is a 400. A missing or cross-organization observation is a 404
 * (`NotFoundError`); an **already-decided** observation is a message-only
 * `DomainError` → 400 — the decision happens once.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.reviewObservation, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);
    if (!isCompetitorAuthorized(access, COMPETITOR_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseReviewObservationBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCompetitorStore(getDb().db);

    let observation;
    try {
      observation = await reviewCompetitorObservation(store, {
        organizationId,
        actorId: session.userId,
        observationId: id,
        decision: parsed.input.decision,
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

    return jsonOk({ observation: toObservationRow(organizationId, observation) });
  });
}
