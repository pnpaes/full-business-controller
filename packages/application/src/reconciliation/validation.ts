import {
  DomainError,
  MONEY_SCALE,
  defaultToleranceFor,
  formatDecimal,
  parseDecimal,
  toleranceAmount,
  type ToleranceKind,
} from "@aquarela/domain";
import { RECONCILIATION_SCOPE_TYPE as CANONICAL_RECONCILIATION_SCOPE_TYPE } from "@aquarela/persistence";

import type { ReconciliationStore } from "./types";

/**
 * Canonical `reconciliation.scope_type` values (`DEC-078` (b), migration
 * `0028`; `schemas/domain-enums.yaml`). Deliberately distinct from the
 * cost/ownership `scope_type`. Widened to `readonly string[]` so the commands
 * can membership-test a caller string without a cast, mirroring
 * `imports/vocabularies.ts`.
 */
export const RECONCILIATION_SCOPE_TYPE: readonly string[] = CANONICAL_RECONCILIATION_SCOPE_TYPE;

/**
 * Rejects a caller-supplied `reconciliation.scope_type` that is not one of the
 * `DEC-078` (b) values (`reconciliation_scope_type_check`, migration `0028`),
 * rather than accepting free text. `undefined` is allowed: the command falls
 * back to the scope it owns (`import_run` / `settlement`).
 */
export function assertReconciliationScopeType(scopeType: string | undefined): void {
  if (scopeType !== undefined && !RECONCILIATION_SCOPE_TYPE.includes(scopeType)) {
    throw new DomainError(
      `unknown reconciliation scope_type "${scopeType}" (DEC-078): expected one of ${RECONCILIATION_SCOPE_TYPE.join(", ")}`,
    );
  }
}

export interface ResolveToleranceInput {
  readonly kind: ToleranceKind;
  readonly expected: string;
  /** Explicit caller override (`numeric(19,4)`). */
  readonly tolerance?: string;
  /**
   * Explicit opt-in to the published `DEC-026` default. Since `DEC-072` the
   * effective-dated config usually supplies the tolerance, so the published
   * default is only the documented `DEC-026` bootstrap fallback and is never
   * applied implicitly: a missing tolerance blocks close rather than defaulting
   * silently.
   */
  readonly useDecisionDefaultTolerance?: boolean;
}

export interface ResolveEffectiveToleranceInput {
  readonly organizationId: string;
  readonly kind: ToleranceKind;
  /** `date` (`yyyy-mm-dd`): the reconciliation period end the config is read at. */
  readonly asOf: string;
  /** The reconciliation's expected amount; the config's rate applies to `|expected|`. */
  readonly expected: string;
  /** Explicit caller override (`numeric(19,4)`); wins over everything else. */
  readonly tolerance?: string;
  /** Explicit opt-in to the published `DEC-026` default when no config row exists. */
  readonly useDecisionDefaultTolerance?: boolean;
}

/**
 * Resolves the tolerance to apply from the store (`DEC-072`), in precedence
 * order:
 *
 * 1. an explicit `tolerance` (normalized/validated `>= 0`), else
 * 2. the effective `reconciliation_tolerance` config row for
 *    `(organizationId, kind)` at `asOf`, applied as
 *    `toleranceAmount({ rate, floorAmount, expected })`, else
 * 3. an explicit `useDecisionDefaultTolerance === true`, which applies the
 *    published `DEC-026` `defaultToleranceFor` (the documented bootstrap
 *    fallback), else
 * 4. a `DomainError`: a missing tolerance **blocks close** and is never
 *    defaulted silently.
 */
export async function resolveEffectiveTolerance(
  tx: ReconciliationStore,
  input: ResolveEffectiveToleranceInput,
): Promise<string> {
  if (input.tolerance !== undefined) {
    const parsed = parseDecimal(input.tolerance, MONEY_SCALE);
    if (parsed < 0n) {
      throw new DomainError("tolerance must not be negative");
    }
    return formatDecimal(parsed, MONEY_SCALE);
  }

  const config = await tx.findReconciliationTolerance({
    organizationId: input.organizationId,
    kind: input.kind,
    asOf: input.asOf,
  });
  if (config !== undefined) {
    return toleranceAmount({
      rate: config.rate,
      floor: config.floorAmount,
      expected: input.expected,
    });
  }

  if (input.useDecisionDefaultTolerance === true) {
    return defaultToleranceFor(input.kind, input.expected);
  }

  throw new DomainError(
    "a reconciliation tolerance is required: no explicit tolerance and no effective DEC-072 tolerance configuration for the period, so close is blocked (a missing tolerance is never defaulted silently)",
  );
}

/**
 * Synchronous `DEC-026` resolver retained for the pure tests and callers that
 * resolve without a store. It has no config-row step (there is no store here);
 * the commands use `resolveEffectiveTolerance`. An explicit `tolerance` wins; an
 * explicit `useDecisionDefaultTolerance` applies the published default; neither
 * is a `DomainError`, because a missing FIN-owned tolerance blocks close.
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
    "a reconciliation tolerance is required: no explicit tolerance and no DEC-026 opt-in, so a missing tolerance must not default silently (it blocks close)",
  );
}
