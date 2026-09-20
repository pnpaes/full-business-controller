import { createPostgresReconciliationStore, resolveReconciliation } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { reconciliationLimiters } from "../../limiters";
import { parseResolveReconciliationBody, toReconciliationRows } from "../../reconciliation-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moves a reconciliation through its lifecycle and records the resolution trail
 * (`REC-001`/`005`). The status must be in `RECONCILIATION_STATUS`, and moving to
 * `resolved`/`approved` requires a `resolutionNote` so an exception is never
 * closed without a reason. The organization is part of the update's WHERE
 * clause, so another tenant's row can never be patched.
 *
 * There is no approval-workflow table: the actor is the session user and the
 * audit fact is the trail. Signed out → 401; a malformed id/body → 400; an
 * unknown/foreign row or a missing note → 400 with the authored `DomainError`
 * message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, reconciliationLimiters.resolve, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseResolveReconciliationBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresReconciliationStore(getDb().db);

    let record: Awaited<ReturnType<typeof resolveReconciliation>>;
    try {
      record = await resolveReconciliation(store, {
        organizationId,
        actorId: session.userId,
        reconciliationId: id,
        status: parsed.input.status,
        ...(parsed.input.resolutionNote === null
          ? {}
          : { resolutionNote: parsed.input.resolutionNote }),
        ...(parsed.input.ownerId === null ? {} : { ownerId: parsed.input.ownerId }),
        ...(parsed.input.dueDate === null ? {} : { dueDate: parsed.input.dueDate }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ reconciliation: toReconciliationRows(organizationId, [record])[0] ?? null });
  });
}
