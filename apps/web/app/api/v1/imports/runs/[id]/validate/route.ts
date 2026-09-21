import { createPostgresImportStore, validateImportRun } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../../../lib/auth";
import { getDb } from "../../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../../lib/request";

import { parseValidateImportRunBody } from "../../../import-rows";
import { importLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates every staged row and moves the run to `validated` or `needs_review`
 * (`SALE-004`, step 4). Invalid rows are kept and marked; per-currency
 * `gross_amount` totals are recorded for the preview. The run's resolved
 * `import_profile` supplies the base validation rules and the request's rules
 * override them field by field (`DEC-081`); no amount tolerance is applied (no
 * tolerance table; `DEC-026`/`DEC-035`).
 *
 * Only a `parsed` run can be validated; anything else is a 400. Signed out → 401.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, importLimiters.review, async () => {
    const { session } = await requireSession(request);
    const { id } = await context.params;
    if (!UUID.test(id)) {
      return jsonError(400);
    }

    const parsed = parseValidateImportRunBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);

    let result: {
      importRunId: string;
      status: string;
      rowCount: number;
      validCount: number;
      errorCount: number;
      issues: readonly unknown[];
    };
    try {
      result = await validateImportRun(store, {
        organizationId,
        actorId: session.userId,
        importRunId: id,
        rules: parsed.rules,
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
      rowCount: result.rowCount,
      validCount: result.validCount,
      errorCount: result.errorCount,
      issueCount: result.issues.length,
    });
  });
}
