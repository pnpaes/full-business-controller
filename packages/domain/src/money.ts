import { normalizeCurrency } from "./currency";
import { formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";

/** Money is stored as numeric(19,4): four decimal places (DATA_DICTIONARY §0). */
export const MONEY_SCALE = 4;

/** Factors (quantities, percentages, ratios) are carried at quantity scale. */
const FACTOR_SCALE = 6;

export class Money {
  readonly currency: string;
  readonly #units: bigint;

  private constructor(units: bigint, currency: string) {
    this.#units = units;
    this.currency = currency;
  }

  static from(value: string, currency: string): Money {
    return new Money(parseDecimal(value, MONEY_SCALE), normalizeCurrency(currency));
  }

  static zero(currency: string): Money {
    return Money.from("0", currency);
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#units + other.#units, this.currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#units - other.#units, this.currency);
  }

  multiply(factor: string): Money {
    const scaledFactor = parseDecimal(factor, FACTOR_SCALE);
    const product = this.#units * scaledFactor;
    return new Money(rescale(product, MONEY_SCALE + FACTOR_SCALE, MONEY_SCALE), this.currency);
  }

  negate(): Money {
    return new Money(-this.#units, this.currency);
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.#units === other.#units;
  }

  compare(other: Money): number {
    this.#assertSameCurrency(other);
    if (this.#units < other.#units) {
      return -1;
    }
    if (this.#units > other.#units) {
      return 1;
    }
    return 0;
  }

  /** Canonical string form, always at money scale (e.g. `"49.7500"`). */
  toString(): string {
    return formatDecimal(this.#units, MONEY_SCALE);
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toString(), currency: this.currency };
  }

  #assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(`currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
