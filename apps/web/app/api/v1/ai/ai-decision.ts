import { createPostgresAiAdvisoryStore, type AiAdvisoryWriteStore } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import type { RateLimiter } from "../../../../lib/rate-limit";

import { AI_SUGGESTION_ID_PATTERN } from "./ai-rows";
import { isAiAuthorized, AI_DECIDE_ROLES, loadAiAccess } from "./access";

export interface AiDecisionMutation {
  readonly organizationId: string;
  readonly suggestionId: string;
  readonly actorId: string;
  readonly store: AiAdvisoryWriteStore;
}

/**
 * The shared guard chain for the AI-suggestion decisions
 * (`POST /api/v1/ai/suggestions/[id]/approve|reject`), mirroring the jobs DLQ
 * mutation pattern: `withMutationGuards` (same-origin first, then the fail-closed
 * per-IP throttle), `requireSession` (401), `AI_DECIDE_ROLES` (403), a UUID check
 * on the id (400) and the serving organization. A `NotFoundError` from the
 * command is an indistinguishable 404; any other `DomainError` is a 400 with its
 * authored message.
 */
export async function withAiDecisionMutation(
  request: Request,
  limiter: RateLimiter,
  context: { readonly params: Promise<{ readonly id: string }> },
  run: (input: AiDecisionMutation) => Promise<Response>,
): Promise<Response> {
  return withMutationGuards(request, limiter, async () => {
    const { session } = await requireSession(request);
    const access = await loadAiAccess(session.userId);
    if (!isAiAuthorized(access, AI_DECIDE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!AI_SUGGESTION_ID_PATTERN.test(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresAiAdvisoryStore(getDb().db);
    try {
      return await run({ organizationId, suggestionId: id, actorId: session.userId, store });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}
