import { createPostgresSalesStore, postImportRun } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";
import { salesLimiters } from "../../../limiters";
import { parsePostImportRunBody } from "../../../sales-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Posts a **validated** import run's staged rows into `sales_transaction` /
 * `sales_line` (`SALE-003`/`005`; `DEC-025`, `DEC-035`, `DEC-042`, `DEC-043`,
 * `DEC-045`). Idempotent on the external keys, so a retry reuses the existing
 * transactions/lines instead of duplicating them; a run that posts every row is
 * `posted`, a partial one `partially_posted`.
 *
 * Signed out → 401; a malformed id or body → 400; an unknown/foreign run or an
 * illegal state (a run that is not `validated`/`needs_review`) → 400 with the
 * authored `DomainError` message.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, salesLimiters.postImportRun, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parsePostImportRunBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSalesStore(getDb().db);

    let result: {
      importRunId: string;
      status: string;
      postedCount: number;
      notPostedCount: number;
      transactionCount: number;
      includedLineCount: number;
    };
    try {
      result = await postImportRun(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
        ...(parsed.sourceSystem === null ? {} : { sourceSystem: parsed.sourceSystem }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      importRunId: result.importRunId,
      status: result.status,
      postedCount: result.postedCount,
      notPostedCount: result.notPostedCount,
      transactionCount: result.transactionCount,
      includedLineCount: result.includedLineCount,
    });
  });
}
