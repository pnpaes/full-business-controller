import {
  createPostgresPeriodCloseStore,
  findPeriodClose,
  lockPeriodClose,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";

import {
  isPeriodCloseAuthorized,
  loadPeriodCloseAccess,
  PERIOD_CLOSE_COMPANY_WRITE_ROLES,
  PERIOD_CLOSE_WRITE_ROLES,
} from "../../access";
import { periodCloseLimiters } from "../../limiters";
import { isUuid, toPeriodCloseRow } from "../../period-close-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Locks one close (`REC-003`/`REC-006`, `DEC-027`, row 13a), freezing its
 * snapshot. The actor is the session user.
 *
 * Locking requires the write roles; a `company` scope additionally requires the
 * company-write roles, and a location-scoped caller must hold the close's
 * `scopeId` location (403 otherwise). The scope is only known after an
 * organization-scoped read (`DEC-061`), so an unknown or cross-organization id is
 * a 404 before the scope check. A non-UUID id is a 400. An already-locked close is
 * an idempotent 200; locking a close that is not `closing` is a typed
 * `DomainError` → 400.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, periodCloseLimiters.lockPeriodClose, async () => {
    const { session } = await requireSession(request);
    const access = await loadPeriodCloseAccess(session.userId);
    if (!isPeriodCloseAuthorized(access, PERIOD_CLOSE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
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
      !isPeriodCloseAuthorized(access, PERIOD_CLOSE_WRITE_ROLES, existing.scopeId)
    ) {
      return jsonError(403);
    }
    if (
      existing.scopeType === "company" &&
      !isPeriodCloseAuthorized(access, PERIOD_CLOSE_COMPANY_WRITE_ROLES)
    ) {
      return jsonError(403);
    }

    let close;
    try {
      close = await lockPeriodClose(store, {
        organizationId,
        actorId: session.userId,
        periodCloseId: id,
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
