import { createPostgresAiAdvisoryStore, listAiSuggestions } from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { isAiAuthorized, AI_READ_ROLES, loadAiAccess } from "../access";
import { parseAiSuggestionsQuery, toAiSuggestionRows } from "../ai-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The served organization's AI suggestions (`ADR-0009`, `DEC-142`), newest
 * first. The review queue an operator works from. **Advisory only:** a
 * suggestion is a model's opinion awaiting human review; nothing here applies
 * it.
 *
 * Query: optional `state` (one of `proposed`, `approved`, `rejected`,
 * `superseded`) and `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`, each row `{ id, state, scopeType,
 * scopeRef, suggestion, runId, decidedBy, decidedAt, reason, createdAt }` —
 * **no raw `input_snapshot`/`output`/cost**. Signed out → 401; a role outside
 * `AI_READ_ROLES` (provisional, `DEC-101` unset) → 403; a malformed filter or
 * paging value → 400. Never returns another organization's data (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadAiAccess(session.userId);
    if (!isAiAuthorized(access, AI_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseAiSuggestionsQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAiAdvisoryStore(getDb().db);
    const rows = await listAiSuggestions(store, {
      organizationId,
      ...(parsed.query.state === undefined ? {} : { state: parsed.query.state }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toAiSuggestionRows(rows),
    });
  });
}
