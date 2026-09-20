import {
  DomainError,
  MONEY_SCALE,
  defaultToleranceFor,
  formatDecimal,
  parseDecimal,
  type ToleranceKind,
} from "@aquarela/domain";

export interface ResolveToleranceInput {
  readonly kind: ToleranceKind;
  readonly expected: string;
  /** Explicit caller override (`numeric(19,4)`). */
  readonly tolerance?: string;
  /**
   * Explicit opt-in to the published `DEC-026` default. There is no
   * tolerance-configuration table, so the default is never applied implicitly:
   * a missing tolerance blocks close rather than defaulting silently.
   */
  readonly useDecisionDefaultTolerance?: boolean;
}

/**
 * Resolves the tolerance to apply (`DEC-026`). An explicit `tolerance` wins; an
 * explicit `useDecisionDefaultTolerance` applies the published default; neither
 * is a `DomainError`, because a missing FIN-owned tolerance blocks close rather
 * than defaulting silently (open point (b): no tolerance table exists).
 */
export function resolveTolerance(input: ResolveToleranceInput): string {
  if (input.tolerance !== undefined) {
    const parsed = parseDecimal(input.tolerance, MONEY_SCALE);
    if (parsed < 0n) {
      throw new DomainError("tolerance must not be negative");
    }
    return formatDecimal(parsed, MONEY_SCALE);
  }
  if (input.useDecisionDefaultTolerance === true) {
    return defaultToleranceFor(input.kind, input.expected);
  }
  throw new DomainError(
    "a reconciliation tolerance is required: DEC-026's effective-dated tolerance configuration has no table, so a missing tolerance must not default silently (it blocks close)",
  );
}
