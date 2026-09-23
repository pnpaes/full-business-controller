/**
 * Pure domain logic for the `DEC-117` downstream-reconciliation reversal gate
 * (`DEC-028`/`DEC-073`). It decides whether an automatic sales-line reversal may
 * proceed for one parent transaction day, given the covering reconciliation
 * statuses and the two close-lock answers. Nothing here touches the database.
 *
 * **Evaluation order** (`DEC-117`): a locked period is the stronger reason, so
 * the `location` lock is checked first, then the `company` lock, then
 * reconciliation coverage. A covering reconciliation blocks only when its status
 * is one of `RECONCILED_RECONCILIATION_STATUSES`; `pending`/`exception` and any
 * status outside the vocabulary do not block.
 */

/** The `reconciliation.status` values that block a reversal (`DEC-117`). */
export const RECONCILED_RECONCILIATION_STATUSES = [
  "within_tolerance",
  "resolved",
  "approved",
] as const;

export interface ReversalGateInput {
  /** The statuses of every organization reconciliation covering the day. */
  readonly coveringReconciliationStatuses: readonly string[];
  /** A `locked` close covers the transaction's `(location_id, day)`. */
  readonly locationLocked: boolean;
  /** A `locked` close covers the `(organization_id, day)`. */
  readonly companyLocked: boolean;
}

export interface ReversalGateDecision {
  readonly allowed: boolean;
  /** The blocking reason; present exactly when `allowed` is false. */
  readonly reason: string | null;
}

const ALLOWED: ReversalGateDecision = { allowed: true, reason: null };

/** The distinct, sorted covering statuses that block a reversal. */
function blockingStatuses(statuses: readonly string[]): readonly string[] {
  const matched = statuses.filter((status) =>
    (RECONCILED_RECONCILIATION_STATUSES as readonly string[]).includes(status),
  );
  return [...new Set(matched)].sort();
}

/**
 * Decides whether one reversal may proceed (`DEC-117`): blocked by a locked
 * `location` or `company` period, or by a covering reconciliation in a
 * reconciled status. A blocked decision carries a message-only reason; nothing
 * else is returned, because the caller posts nothing on a block.
 */
export function evaluateReversalGate(input: ReversalGateInput): ReversalGateDecision {
  if (input.locationLocked) {
    return {
      allowed: false,
      reason: "cannot reverse a sales line in a period locked for its location",
    };
  }
  if (input.companyLocked) {
    return {
      allowed: false,
      reason: "cannot reverse a sales line in a period locked for the company",
    };
  }
  const reconciled = blockingStatuses(input.coveringReconciliationStatuses);
  if (reconciled.length > 0) {
    return {
      allowed: false,
      reason: `cannot reverse a sales line in a reconciled period (${reconciled.join(", ")})`,
    };
  }
  return ALLOWED;
}
