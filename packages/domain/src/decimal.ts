import { DomainError } from "./errors";

const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Parses a base-10 string into an integer scaled by `scale`, rejecting anything
 * that is not a plain decimal or that carries more precision than `scale`.
 * Values are kept as BigInt: money and quantities are never represented as floats.
 */
export function parseDecimal(value: string, scale: number): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new DomainError(`"${value}" is not a valid decimal string`);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (fraction.length > scale) {
    throw new DomainError(`"${value}" has more than ${scale} decimal places`);
  }

  const digits = `${whole}${fraction.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  const magnitude = BigInt(digits);
  return negative ? -magnitude : magnitude;
}

export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Integer division rounded HALF_UP (half away from zero), per DEC-024. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new DomainError("division by zero");
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function rescale(value: bigint, fromScale: number, toScale: number): bigint {
  if (toScale === fromScale) {
    return value;
  }
  if (toScale > fromScale) {
    return value * 10n ** BigInt(toScale - fromScale);
  }
  return divideRoundHalfUp(value, 10n ** BigInt(fromScale - toScale));
}
