import { decideAiSuggestion } from "@aquarela/application";

import { jsonError, jsonOk } from "../../../../../../../lib/http";

import { withAiDecisionMutation } from "../../../ai-decision";
import { parseDecisionReason, toAiSuggestionRow } from "../../../ai-rows";
import { aiLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rejects one AI suggestion (`ADR-0009`, `DEC-142`). The suggestion must still
 * be `proposed` and a non-blank `reason` is **required** (there is no silent
 * rejection); the decision and its audit fact (`ai.suggestion.rejected`) commit
 * together.
 *
 * **Advisory only:** rejecting records a human's opinion and nothing else. The
 * response carries `advisoryOnly: true`.
 *
 * Signed out → 401; a role outside `AI_DECIDE_ROLES` → 403; a non-UUID id, a
 * malformed body or a blank/missing reason → 400; an unknown or
 * other-organization id → 404; a suggestion no longer `proposed` → 400. Returns
 * `{ ok: true, advisoryOnly: true, suggestion }`.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withAiDecisionMutation(
    request,
    aiLimiters.decideSuggestion,
    context,
    async ({ organizationId, suggestionId, actorId, store }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonError(400);
      }
      const parsed = parseDecisionReason(body);
      if (!parsed.ok) {
        return jsonError(400);
      }

      const decided = await decideAiSuggestion(store, {
        organizationId,
        actorId,
        suggestionId,
        decision: "rejected",
        reason: parsed.reason,
      });
      return jsonOk({ advisoryOnly: true, suggestion: toAiSuggestionRow(decided) });
    },
  );
}
