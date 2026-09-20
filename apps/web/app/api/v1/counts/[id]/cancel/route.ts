import { cancelStockCount, createPostgresCountStore } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { countsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cancels an open count (`INV-004`). An approved count cannot be cancelled — its
 * movements are already in the append-only ledger — so that is a 400. No body is
 * read.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, countsLimiters.cancel, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCountStore(getDb().db);

    let result: { status: string };
    try {
      result = await cancelStockCount(store, {
        organizationId,
        actorId: session.userId,
        stockCountId: id,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ status: result.status });
  });
}
