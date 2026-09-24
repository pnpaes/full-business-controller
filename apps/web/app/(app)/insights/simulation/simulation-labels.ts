/**
 * Presentation helpers for the what-if simulation screen (`W6`, `DEC-125`).
 *
 * This module is imported by a **client** component, so it deliberately does not
 * import `@aquarela/domain`: that barrel pulls `node:crypto` (auth recovery
 * codes) into the browser bundle. The decimal maths below is display-only and
 * local.
 *
 * ponytail: a ~30-line duplicate of `packages/domain/src/decimal.ts` for the
 * browser bundle boundary. If the domain package ever exposes a browser-safe
 * decimal subpath export, replace these with it.
 */

/** Parses a decimal string into an integer scaled by `scale` (display-only). */
function parseScaled(value: string, scale: number): bigint {
  const negative = value.trim().startsWith("-");
  const unsigned = value.trim().replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`;
  const magnitude = BigInt(digits.replace(/^0+(?=\d)/, "") || "0");
  return negative ? -magnitude : magnitude;
}

/** Rescales a scaled integer, HALF_UP when narrowing (display-only). */
function rescale(value: bigint, fromScale: number, toScale: number): bigint {
  if (toScale === fromScale) {
    return value;
  }
  if (toScale > fromScale) {
    return value * 10n ** BigInt(toScale - fromScale);
  }
  const divisor = 10n ** BigInt(fromScale - toScale);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Formats a scaled integer as a fixed-scale decimal string. */
function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function atScale(value: string, fromScale: number, toScale: number): string {
  return formatScaled(rescale(parseScaled(value, fromScale), fromScale, toScale), toScale);
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** `numeric(19,4)` money → a 2 dp display string (`DEC-024`). */
export function formatMoney(value: string): string {
  return atScale(value, 4, 2);
}

/** `numeric(19,6)` quantity → a 3 dp display string with trailing zeros trimmed. */
export function formatQuantity(value: string): string {
  return trimZeros(atScale(value, 6, 3));
}

/** Hours at 6 dp → a 2 dp display string with trailing zeros trimmed. */
export function formatHours(value: string): string {
  return trimZeros(atScale(value, 6, 2));
}

/** A 2 dp percentage string → "10.0%", or "n/a" when undefined. */
export function formatPct(value: string | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${atScale(value, 2, 1)}%`;
}

/** A `yyyy-mm-dd` date input → the start of that UTC day as an ISO instant. */
export function startOfDayInstant(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** A `yyyy-mm-dd` date input → the end of that UTC day as an ISO instant. */
export function endOfDayInstant(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/** The previous whole UTC calendar month, as `yyyy-mm-dd` bounds. */
export function previousMonthPeriod(now: Date): { readonly from: string; readonly to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** The scenario-builder form state. */
export interface SimulationFormInput {
  readonly locationId: string;
  /** `yyyy-mm-dd` from the date input. */
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly volumeChangePct: string;
  readonly priceChangePct: string;
  readonly wageChangePct: string;
  /** Removed recipe ids. */
  readonly menuRemovals: readonly string[];
  readonly menuAdds: readonly {
    readonly recipeId: string;
    readonly expectedUnitsPerPeriod: string;
  }[];
  readonly headcountChange: readonly {
    readonly roleCode: string;
    readonly countDelta: string;
    readonly hoursPerPeriod: string;
    readonly costCenterId: string;
  }[];
}

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Builds the `POST /api/v1/simulation` body from the form state. Blank optional
 * fields are omitted (never sent as `""`); the baseline window is converted from
 * `yyyy-mm-dd` dates to inclusive ISO instants. Pure and total — the API
 * re-validates everything.
 */
export function buildSimulationBody(
  input: SimulationFormInput,
  asOf: string,
): Record<string, unknown> {
  const volume = trimmed(input.volumeChangePct);
  const price = trimmed(input.priceChangePct);
  const wage = trimmed(input.wageChangePct);

  const headcount = input.headcountChange
    .map((row) => ({
      roleCode: row.roleCode.trim(),
      countDelta: row.countDelta.trim(),
      hoursPerPeriod: row.hoursPerPeriod.trim(),
      costCenterId: trimmed(row.costCenterId),
    }))
    .filter((row) => row.roleCode.length > 0 || row.countDelta.length > 0)
    .map((row) => ({
      roleCode: row.roleCode,
      countDelta: row.countDelta,
      hoursPerPeriod: row.hoursPerPeriod,
      ...(row.costCenterId === undefined ? {} : { costCenterId: row.costCenterId }),
    }));

  return {
    asOf,
    locationId: input.locationId,
    baseline: {
      periodFrom: startOfDayInstant(input.periodFrom),
      periodTo: endOfDayInstant(input.periodTo),
    },
    ...(volume === undefined ? {} : { volumeChangePct: volume }),
    ...(price === undefined ? {} : { priceChangePct: price }),
    ...(wage === undefined ? {} : { wageChangePct: wage }),
    ...(input.menuRemovals.length === 0
      ? {}
      : { menuRemovals: input.menuRemovals.map((recipeId) => ({ recipeId })) }),
    ...(input.menuAdds.length === 0 ? {} : { menuAdds: input.menuAdds }),
    ...(headcount.length === 0 ? {} : { headcountChange: headcount }),
  };
}
