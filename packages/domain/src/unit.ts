import { divideRoundHalfUp, formatDecimal, parseDecimal } from "./decimal";
import { DomainError } from "./errors";
import { QUANTITY_SCALE, Quantity } from "./quantity";

/** Controlled dimension vocabulary (`schemas/domain-enums.yaml`: `unit_dimension`). */
export const UNIT_DIMENSIONS = ["mass", "volume", "count", "time", "package"] as const;

export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

/** Conversion factors are `numeric(19,6)` (`DATA_DICTIONARY` §2). */
const FACTOR_SCALE = 6;
/** Divisor that rescales the scale-12 product back to quantity scale. */
const FACTOR_DIVISOR = 10n ** BigInt(FACTOR_SCALE);

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
    // Runtime guard for JS callers; typed callers cannot pass anything else.
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
 * Compatibility for **pack conversions** (PROC-001, DEC-051): units of the same
 * dimension always convert, and a `package` unit converts to any unit of another
 * dimension. A supplier pack is expressed against the *item's* `base_unit_id`,
 * which need not be the dimension's canonical base (an item may be based in
 * `kg`), so `pack → kg` is allowed here.
 *
 * The `unit_conversion` table is deliberately **stricter** — use
 * `areConversionEdgeUnits` for stored edges, which must resolve to the
 * dimension's `is_base` unit (`DATA_DICTIONARY` §2).
 */
export function areUnitsConvertible(a: Unit, b: Unit): boolean {
  return a.dimension === b.dimension || a.dimension === "package" || b.dimension === "package";
}

/**
 * The `unit_conversion` edge rule (`DATA_DICTIONARY` §2, FND-003): dimensions
 * must match, **unless** one side is a `package` unit and the other is the
 * canonical base unit of another dimension (`pack → g` is allowed; `pack → kg`
 * is not, because `kg` is not `is_base`). Kept separate from
 * `areUnitsConvertible` so the pack rule cannot silently loosen the stored-edge
 * rule (DEC-051).
 */
export function areConversionEdgeUnits(a: Unit, b: Unit): boolean {
  return (
    a.dimension === b.dimension ||
    (a.dimension === "package" && b.isBase) ||
    (b.dimension === "package" && a.isBase)
  );
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
  const converted = divideRoundHalfUp(scaled, FACTOR_DIVISOR);
  return Quantity.from(formatDecimal(converted, QUANTITY_SCALE), to.code);
}
