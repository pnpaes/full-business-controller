import {
  DomainError,
  MONEY_SCALE,
  TOLERANCE_KINDS,
  formatDecimal,
  parseDecimal,
  type ToleranceKind,
} from "@aquarela/domain";

import { RECONCILIATION_AUDIT_ACTIONS } from "./actions";
import type { ReconciliationStore, ReconciliationToleranceRecord } from "./types";

/** `reconciliation_tolerance.rate` is `numeric(9,6)`. */
const TOLERANCE_RATE_SCALE = 6;

export interface RegisterReconciliationToleranceInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly kind: ToleranceKind;
  /** `numeric(9,6)` fraction applied to `|expected|`; `>= 0`. */
  readonly rate: string;
  /** `numeric(19,4)` NOK floor; `>= 0`. */
  readonly floorAmount: string;
  /** `date` (`yyyy-mm-dd`), inclusive start of the effective window. */
  readonly effectiveFrom: string;
  /**
   * `date` (`yyyy-mm-dd`), exclusive end of the effective window; omitted or
   * null leaves the window open. When set it must be after `effectiveFrom`.
   */
  readonly effectiveTo?: string | null;
}

export interface RegisterReconciliationToleranceResult {
  readonly toleranceId: string;
  readonly kind: ToleranceKind;
  readonly rate: string;
  readonly floorAmount: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** Half-open interval overlap: `[aFrom, aTo)` and `[bFrom, bTo)`, null = open end. */
function windowsOverlap(
  a: { readonly from: string; readonly to: string | null },
  b: { readonly from: string; readonly to: string | null },
): boolean {
  return (b.to === null || a.from < b.to) && (a.to === null || b.from < a.to);
}

/**
 * Registers one effective-dated tolerance config row (`DEC-072`; `REC-001`/`005`)
 * for a `(organizationId, kind)`.
 *
 * Validates the kind against `TOLERANCE_KINDS`, parses the rate at
 * `numeric(9,6)` and the floor at money scale (both `>= 0`), and requires
 * `effectiveTo > effectiveFrom` when an end is given. A window overlapping an
 * existing one for the same `(organizationId, kind)` is rejected with a
 * `DomainError` before any write (the `reconciliation_tolerance_no_overlap`
 * EXCLUDE constraint is the DB backstop). The row and an audit fact are written
 * together; `reconciliation.tolerance` stays the per-row snapshot of what a
 * reconciliation applied.
 */
export async function registerReconciliationTolerance(
  store: ReconciliationStore,
  input: RegisterReconciliationToleranceInput,
): Promise<RegisterReconciliationToleranceResult> {
  if (!TOLERANCE_KINDS.includes(input.kind)) {
    throw new DomainError(`unknown tolerance kind "${input.kind}"`);
  }

  const rate = parseDecimal(input.rate, TOLERANCE_RATE_SCALE);
  if (rate < 0n) {
    throw new DomainError("tolerance rate must not be negative");
  }
  const floor = parseDecimal(input.floorAmount, MONEY_SCALE);
  if (floor < 0n) {
    throw new DomainError("tolerance floorAmount must not be negative");
  }

  const effectiveFrom = input.effectiveFrom;
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) {
    throw new DomainError("tolerance effectiveTo must be after effectiveFrom");
  }

  return store.withTransaction(async (tx) => {
    const existing = await tx.listReconciliationTolerances({
      organizationId: input.organizationId,
      kind: input.kind,
    });
    for (const row of existing) {
      const overlaps = windowsOverlap(
        { from: effectiveFrom, to: effectiveTo },
        { from: row.effectiveFrom, to: row.effectiveTo },
      );
      if (overlaps) {
        throw new DomainError(
          `tolerance window [${effectiveFrom}, ${effectiveTo ?? "open"}) overlaps an existing ${input.kind} window [${row.effectiveFrom}, ${row.effectiveTo ?? "open"})`,
        );
      }
    }

    const record: ReconciliationToleranceRecord = await tx.createReconciliationTolerance({
      organizationId: input.organizationId,
      kind: input.kind,
      rate: formatDecimal(rate, TOLERANCE_RATE_SCALE),
      floorAmount: formatDecimal(floor, MONEY_SCALE),
      effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECONCILIATION_AUDIT_ACTIONS.toleranceRegistered,
      entityType: "reconciliation_tolerance",
      entityId: record.id,
      after: {
        kind: record.kind,
        rate: record.rate,
        floor_amount: record.floorAmount,
        effective_from: record.effectiveFrom,
        effective_to: record.effectiveTo,
      },
    });

    return {
      toleranceId: record.id,
      kind: record.kind,
      rate: record.rate,
      floorAmount: record.floorAmount,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
    };
  });
}
