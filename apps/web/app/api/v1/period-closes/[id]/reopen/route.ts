import {
  createPostgresPeriodCloseStore,
  findPeriodClose,
  reopenPeriodClose,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";

import {
  isPeriodCloseAuthorized,
  loadPeriodCloseAccess,
  PERIOD_CLOSE_REOPEN_ROLES,
} from "../../access";
import { periodCloseLimiters } from "../../limiters";
import { isUuid, parseReopenBody, toPeriodCloseRow } from "../../period-close-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reopens one locked close (`REC-006`, `DEC-027`, row 13a): the elevated,
 * audited correction path. The actor is the session user.
 *
 * Reopening requires `PERIOD_CLOSE_REOPEN_ROLES` (owner / general_manager /
 * finance / admin). The body must carry a non-empty `reason` (else 400); a
 * non-UUID id is a 400; an unknown or cross-organization close is a 404; a close
 * that is not `locked` is a typed `DomainError` → 400. A location-scoped caller
 * must hold a location close's `scopeId` (403 otherwise) — the scope is only
 * known after the organization-scoped read (`DEC-061`), exactly like the `[id]`
 * read and lock routes. The reopen triple and the audit fact commit or roll back
 * together.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, periodCloseLimiters.reopenPeriodClose, async () => {
    const { session } = await requireSession(request);
    const access = await loadPeriodCloseAccess(session.userId);
    if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_REOPEN_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseReopenBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresPeriodCloseStore(getDb().db);

    const existing = await findPeriodClose(store, { organizationId, periodCloseId: id });
    if (existing === undefined) {
      return jsonError(404);
    }
    if (
      existing.scopeType === "location" &&
      !isPeriodCloseAuthorized(access, PERIOD_CLOSE_REOPEN_ROLES, existing.scopeId)
    ) {
      return jsonError(403);
    }

    let close;
    try {
      close = await reopenPeriodClose(store, {
        organizationId,
        actorId: session.userId,
        periodCloseId: id,
        reason: parsed.input.reason,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ periodClose: toPeriodCloseRow(organizationId, close) });
  });
}
