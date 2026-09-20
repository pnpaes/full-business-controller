import { createPostgresReconciliationStore, reconcileImportRun } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { reconciliationLimiters } from "../../limiters";
import { parseReconcileImportRunBody } from "../../reconciliation-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reconciles a **posted** import run (`REC-005`, `DEC-035`): the source total is
 * compared against `posted + approved dispositions`, and the tolerance applies
 * to the residual after dispositions.
 *
 * Close is blocked while a non-posted row lacks an approved disposition, so a
 * run with an unreviewed row is a 400. The tolerance is the caller's explicit
 * `tolerance` or an explicit `useDecisionDefaultTolerance: true` opt-in to the
 * published `DEC-026` default — there is no tolerance table (open point (b)), so
 * a missing tolerance is a 400, never a silent default. Re-running for the same
 * scope/period updates the existing row rather than creating a duplicate.
 *
 * Signed out → 401; a malformed id/body → 400; an unknown/foreign run or a run
 * that has not posted → 400 with the authored `DomainError` message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, reconciliationLimiters.reconcile, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseReconcileImportRunBody(await readJsonObject(request));
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
      residual: string;
      created: boolean;
    };
    try {
      result = await reconcileImportRun(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
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
      residual: result.residual,
      created: result.created,
    });
  });
}
