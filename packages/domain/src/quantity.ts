import { divideRoundHalfUp, formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";

/** Quantities are stored as numeric(19,6) and paired with a unit (DATA_DICTIONARY §0). */
export const QUANTITY_SCALE = 6;

export class Quantity {
  readonly unit: string;
  readonly #units: bigint;

  private constructor(units: bigint, unit: string) {
    this.#units = units;
    this.unit = unit;
  }

  static from(value: string, unit: string): Quantity {
    if (unit.trim().length === 0) {
      throw new DomainError("quantity unit must not be empty");
    }
    return new Quantity(parseDecimal(value, QUANTITY_SCALE), unit);
  }

  add(other: Quantity): Quantity {
    this.#assertSameUnit(other);
    return new Quantity(this.#units + other.#units, this.unit);
  }

  subtract(other: Quantity): Quantity {
    this.#assertSameUnit(other);
    return new Quantity(this.#units - other.#units, this.unit);
  }

  multiply(factor: string): Quantity {
    const scaledFactor = parseDecimal(factor, QUANTITY_SCALE);
    const product = this.#units * scaledFactor;
    return new Quantity(rescale(product, QUANTITY_SCALE * 2, QUANTITY_SCALE), this.unit);
  }

  divide(divisor: string): Quantity {
    const scaledDivisor = parseDecimal(divisor, QUANTITY_SCALE);
    const scaled = this.#units * 10n ** BigInt(QUANTITY_SCALE);
    return new Quantity(divideRoundHalfUp(scaled, scaledDivisor), this.unit);
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  equals(other: Quantity): boolean {
    return this.unit === other.unit && this.#units === other.#units;
  }

  /** Canonical string form, always at quantity scale (e.g. `"2.500000"`). */
  toString(): string {
    return formatDecimal(this.#units, QUANTITY_SCALE);
  }

  toJSON(): { amount: string; unit: string } {
    return { amount: this.toString(), unit: this.unit };
  }

  #assertSameUnit(other: Quantity): void {
    if (this.unit !== other.unit) {
      throw new DomainError(`unit mismatch: ${this.unit} vs ${other.unit}`);
    }
  }
}
