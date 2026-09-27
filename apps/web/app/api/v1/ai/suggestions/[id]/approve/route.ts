import { decideAiSuggestion } from "@aquarela/application";

import { jsonOk } from "../../../../../../../lib/http";

import { withAiDecisionMutation } from "../../../ai-decision";
import { toAiSuggestionRow } from "../../../ai-rows";
import { aiLimiters } from "../../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approves one AI suggestion (`ADR-0009`, `DEC-142`). The suggestion must still
 * be `proposed`; the decision and its audit fact (`ai.suggestion.approved`)
 * commit together.
 *
 * **Advisory only:** approving records a human's opinion and nothing else — it
 * never publishes a price, places an order or changes a menu. The response
 * carries `advisoryOnly: true` so a client cannot mistake the decision for an
 * applied change.
 *
 * Signed out → 401; a role outside `AI_DECIDE_ROLES` (owner / general_manager /
 * admin) → 403; a non-UUID id → 400; an unknown or other-organization id → 404;
 * a suggestion no longer `proposed` → 400. Returns `{ ok: true, advisoryOnly:
 * true, suggestion }`.
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
      const decided = await decideAiSuggestion(store, {
        organizationId,
        actorId,
        suggestionId,
        decision: "approved",
      });
      return jsonOk({ advisoryOnly: true, suggestion: toAiSuggestionRow(decided) });
    },
  );
}
