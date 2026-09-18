import { DomainError } from "./errors";

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new DomainError(`"${value}" is not a valid ISO 4217 currency code`);
  }
  return currency;
}
