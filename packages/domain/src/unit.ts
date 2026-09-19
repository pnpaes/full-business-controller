import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { QUANTITY_SCALE, Quantity } from "./quantity";

/** Controlled dimension vocabulary (`schemas/domain-enums.yaml`: `unit_dimension`). */
export const UNIT_DIMENSIONS = ["mass", "volume", "count", "time", "package"] as const;

export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

/** Conversion factors are `numeric(19,6)` (`DATA_DICTIONARY` §2). */
const FACTOR_SCALE = 6;

/**
 * A unit of measure (FND-003, PROC-001): its `code` (the schema's `unit.code`),
 * its `dimension`, and whether it is the canonical base unit of that dimension
 * (`unit.is_base`).
 *
 * A unit carries **no** conversion factor. Per `DATA_DICTIONARY` §2 conversions
 * live in the effective-dated, item-scoped `unit_conversion` table (deferred to
 * the master-data slice, per `schemas/phase1_2_draft.sql`), and the domain
 * applies a resolved factor instead of deriving one from the unit itself. That
 * keeps pack resizes and item-specific densities representable as data.
 */
export class Unit {
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase: boolean;

  private constructor(code: string, dimension: UnitDimension, isBase: boolean) {
    this.code = code;
    this.dimension = dimension;
    this.isBase = isBase;
  }

  static from(code: string, dimension: UnitDimension, isBase = false): Unit {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      throw new DomainError("unit code must not be empty");
    }
    if (!UNIT_DIMENSIONS.includes(dimension)) {
      throw new DomainError(`"${dimension}" is not a known unit dimension`);
    }
    return new Unit(trimmed, dimension, isBase);
  }

  /** Generic conversion is only defined within one dimension (FND-003). */
  isCompatibleWith(other: Unit): boolean {
    return this.dimension === other.dimension;
  }

  equals(other: Unit): boolean {
    return (
      this.code === other.code && this.dimension === other.dimension && this.isBase === other.isBase
    );
  }

  toJSON(): { code: string; dimension: UnitDimension; isBase: boolean } {
    return { code: this.code, dimension: this.dimension, isBase: this.isBase };
  }
}

/**
 * Applies a resolved `from` → `to` conversion factor (the `unit_conversion.factor`,
 * `numeric(19,6)`) to a quantity, rounding once HALF_UP at quantity scale (6 dp;
 * DEC-024). The factor is supplied by the caller because it is resolved from the
 * effective-dated, possibly item-scoped conversion graph — this function only
 * validates and applies it. Cross-dimension conversions are rejected.
 */
export function convertQuantity(
  quantity: Quantity,
  from: Unit,
  to: Unit,
  factor: string,
): Quantity {
  if (quantity.unit !== from.code) {
    throw new DomainError(
      `quantity unit "${quantity.unit}" does not match conversion source "${from.code}"`,
    );
  }
  if (!from.isCompatibleWith(to)) {
    throw new DomainError(`incompatible unit dimensions: ${from.dimension} vs ${to.dimension}`);
  }
  const ratio = parseDecimal(factor, FACTOR_SCALE);
  if (ratio <= 0n) {
    throw new DomainError(`conversion factor must be positive, got "${factor}"`);
  }

  const units = parseDecimal(quantity.toString(), QUANTITY_SCALE);
  const scaled = units * ratio;
  const converted = divideRoundHalfUp(scaled, parseDecimal("1", FACTOR_SCALE));
  return Quantity.from(formatDecimal(converted, QUANTITY_SCALE), to.code);
}
