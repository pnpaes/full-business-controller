import { DomainError, NotFoundError } from "@aquarela/domain";

import { AI_AUDIT_ACTIONS, AI_SUGGESTION_ENTITY_TYPE } from "./actions";
import type { AiSuggestionRecord } from "./read-types";
import type { AiAdvisoryWriteStore } from "./write-types";

export type AiSuggestionDecision = "approved" | "rejected";

export interface DecideAiSuggestionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly suggestionId: string;
  readonly decision: AiSuggestionDecision;
  /** Required on `rejected`; optional on `approved`. */
  readonly reason?: string;
}

const DECISIONS: readonly string[] = ["approved", "rejected"];

/**
 * Decides one `ai_suggestion` (`ADR-0009`, `DEC-142`): a human approves or
 * rejects a **still-`proposed`** suggestion, and the decision is audited
 * (`ai.suggestion.approved` / `ai.suggestion.rejected`). A rejection requires a
 * non-blank reason (there is no silent rejection); an approval may carry an
 * optional note. Any other state is refused: `approved`/`rejected`/`superseded`
 * are terminal for this command, so a re-decision is a `DomainError`, and a
 * missing or wrong-organization id is a `NotFoundError` (404-indistinguishable
 * at the route, `DEC-061`).
 *
 * **Advisory only:** approval records a human's opinion and nothing else — it
 * never publishes a price, places an order or changes a menu (`ADR-0009`).
 */
export async function decideAiSuggestion(
  store: AiAdvisoryWriteStore,
  input: DecideAiSuggestionInput,
): Promise<AiSuggestionRecord> {
  if (!DECISIONS.includes(input.decision)) {
    throw new DomainError(`decision must be one of ${DECISIONS.join(", ")}`);
  }
  const reason = input.reason?.trim() ?? "";
  if (input.decision === "rejected" && reason.length === 0) {
    throw new DomainError("reason is required when rejecting a suggestion");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.findAiSuggestionById(input.organizationId, input.suggestionId);
    if (existing === undefined) {
      throw new NotFoundError(`suggestion ${input.suggestionId} not found in this organization`);
    }
    if (existing.state !== "proposed") {
      throw new DomainError(
        `suggestion ${input.suggestionId} is not proposed (state "${existing.state}"); only a proposed suggestion may be decided`,
      );
    }

    const decided = await tx.decideAiSuggestion({
      organizationId: input.organizationId,
      suggestionId: input.suggestionId,
      state: input.decision,
      reason: reason.length === 0 ? null : reason,
      actorId: input.actorId,
    });
    if (decided === undefined) {
      // The state moved between the read and the write (the store pins
      // `state = 'proposed'`), so report the same scoped miss as a re-decision.
      throw new DomainError(
        `suggestion ${input.suggestionId} is no longer proposed; only a proposed suggestion may be decided`,
      );
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action:
        input.decision === "approved"
          ? AI_AUDIT_ACTIONS.suggestionApproved
          : AI_AUDIT_ACTIONS.suggestionRejected,
      entityType: AI_SUGGESTION_ENTITY_TYPE,
      entityId: decided.id,
      ...(reason.length === 0 ? {} : { reason }),
      after: { state: decided.state, reason: decided.reason },
    });

    return decided;
  });
}
