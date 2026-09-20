import { createPostgresReconciliationStore, reconcileSettlement } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { reconciliationLimiters } from "../limiters";
import { parseReconcileSettlementBody } from "../reconciliation-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reconciles a channel **settlement** against posted sales (`REC-001`/`002`,
 * `DEC-026`, `DEC-040`): `expected` is the settlement's `paidAmount` (the
 * provider's own source total) and `actual` is the posted sales total for the
 * same channel/period.
 *
 * The body requires `settlementId`; the tolerance is the explicit `tolerance` or
 * an explicit `useDecisionDefaultTolerance: true` opt-in (no tolerance table,
 * open point (b)). `settlement.status` has no vocabulary (open point (i)), so it
 * is stored facts only and this reconciliation is the judgement. Re-running for
 * the same scope/period updates the existing row.
 *
 * Signed out → 401; a malformed body → 400; an unknown/foreign settlement or one
 * with no paid amount → 400 with the authored `DomainError` message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, reconciliationLimiters.reconcile, async () => {
    const { session } = await requireSession(request);
    const parsed = parseReconcileSettlementBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReconciliationStore(getDb().db);

    let result: {
      reconciliationId: string;
      status: string;
      expected: string;
      actual: string;
      tolerance: string;
      difference: string;
      created: boolean;
    };
    try {
      result = await reconcileSettlement(store, {
        organizationId,
        actorId: session.userId,
        settlementId: parsed.input.settlementId,
        ...(parsed.input.scopeType === null ? {} : { scopeType: parsed.input.scopeType }),
        ...(parsed.input.tolerance === null ? {} : { tolerance: parsed.input.tolerance }),
        useDecisionDefaultTolerance: parsed.input.useDecisionDefaultTolerance,
        ...(parsed.input.ownerId === null ? {} : { ownerId: parsed.input.ownerId }),
        ...(parsed.input.dueDate === null ? {} : { dueDate: parsed.input.dueDate }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      reconciliationId: result.reconciliationId,
      status: result.status,
      expected: result.expected,
      actual: result.actual,
      tolerance: result.tolerance,
      difference: result.difference,
      created: result.created,
    });
  });
}
