import { createPostgresCompetitorStore, updateCompetitorSource } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";

import { canManageCompetitorTerms, canWriteCompetitors, loadCompetitorAccess } from "../../access";
import {
  isUuid,
  parseUpdateCompetitorSourceBody,
  toCompetitorSourceRow,
} from "../../competitor-rows";
import { competitorLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edits one competitor source (`ADR-0010`/`DEC-149` follow-up): its URL, its
 * rate-limit note and/or its collection mode — `collection_mode` was fixed at
 * registration.
 *
 * **The role bar depends on the requested mode, and the body is parsed first so
 * the decision is on the validated mode.** A `manual`/URL/rate-limit edit is a
 * normal competitor write (`COMPETITOR_WRITE_ROLES`); a switch **to
 * `automated`** is a terms decision and is gated to `COMPETITOR_TERMS_ROLES`
 * (owner/admin). `updateCompetitorSource` additionally refuses `automated` unless
 * the source's terms are already approved, so the route cannot enable automation
 * on its own. A non-UUID id or a malformed/empty body is a 400; a missing or
 * cross-organization source is a 404; a duplicate URL or an unapproved-mode
 * switch is a `DomainError` → 400.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, competitorLimiters.updateSource, async () => {
    const { session } = await requireSession(request);
    const access = await loadCompetitorAccess(session.userId);

    const parsed = parseUpdateCompetitorSourceBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }
    const allowed =
      parsed.input.collectionMode === "automated"
        ? canManageCompetitorTerms(access)
        : canWriteCompetitors(access);
    if (!allowed) {
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
      source = await updateCompetitorSource(store, {
        organizationId,
        actorId: session.userId,
        sourceId: id,
        ...(parsed.input.urlOrIdentifier === undefined
          ? {}
          : { urlOrIdentifier: parsed.input.urlOrIdentifier }),
        ...(parsed.input.rateLimitNote === undefined
          ? {}
          : { rateLimitNote: parsed.input.rateLimitNote }),
        ...(parsed.input.collectionMode === undefined
          ? {}
          : { collectionMode: parsed.input.collectionMode }),
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
