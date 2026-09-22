import { closeAdjustmentPeriod, createPostgresAdjustmentPeriodStore } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";

import {
  isAdjustmentPeriodAuthorized,
  loadAdjustmentPeriodAccess,
  ADJUSTMENT_PERIOD_WRITE_ROLES,
} from "../../access";
import { isUuid, toAdjustmentPeriodRow } from "../../adjustment-period-rows";
import { adjustmentPeriodLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Closes one adjustment period (`REC-006`, `DEC-027`, row 13b), ending the
 * correction window. The actor is the session user.
 *
 * Closing requires `ADJUSTMENT_PERIOD_WRITE_ROLES`. A non-UUID id is a 400; an
 * unknown or cross-organization period is a 404; an already-closed period is an
 * idempotent 200; a period that is not `open` is a typed `DomainError` → 400. The
 * command loads the row organization-scoped (`DEC-061`) **under its write lock**
 * and throws `NotFoundError` for a missing/foreign id, which the catch below maps
 * to 404 — so there is no separate pre-read.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, adjustmentPeriodLimiters.closeAdjustmentPeriod, async () => {
    const { session } = await requireSession(request);
    const access = await loadAdjustmentPeriodAccess(session.userId);
    if (!isAdjustmentPeriodAuthorized(access, ADJUSTMENT_PERIOD_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAdjustmentPeriodStore(getDb().db);

    let period;
    try {
      period = await closeAdjustmentPeriod(store, {
        organizationId,
        actorId: session.userId,
        adjustmentPeriodId: id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ adjustmentPeriod: toAdjustmentPeriodRow(organizationId, period) });
  });
}
