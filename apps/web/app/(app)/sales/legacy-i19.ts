/**
 * Parser for the **legacy Zettle/PayPal item-level sales export** reference shape
 * (`I19`, `docs/phase0/SAMPLE_ANALYSIS.md` §9). This is the *reduced* 11-column
 * reference shape the sales import screens and the demo seed use: the legacy
 * export's `Enhet` (always empty), `SKU`/`Strekkode` (always empty),
 * `Innkjøpspris` (always `0`) and `Kommentar` columns carry no usable value in
 * the received file, so they are not part of this shape.
 *
 * It is **reference-only, not authoritative** data (the Frontline export is
 * still outstanding, `I1`): the profile exists to exercise the import framework
 * and the screens. The delimiter is `;`, decimals are comma (`129,00`), and the
 * first row may be the column header.
 *
 * Client-safe: no Node, Next or package imports, so the upload form (a client
 * component) and the operator seed can both use it.
 */

export const LEGACY_I19_COLUMNS = [
  "date",
  "time",
  "receipt",
  "staff",
  "product",
  "variant",
  "quantity",
  "gross_price",
  "discount",
  "line_total",
  "location",
] as const;

/** The currency the received legacy export is denominated in (NOK). */
export const LEGACY_I19_CURRENCY = "NOK";

export interface LegacyI19Row {
  /** 1-based physical line number in the pasted/source text (provenance). */
  readonly sourceRowNo: number;
  /** The row exactly as read, keyed by `LEGACY_I19_COLUMNS`. */
  readonly raw: Record<string, string>;
  /** The profile's normalized projection; the raw row is never mutated. */
  readonly normalized: Record<string, unknown>;
}

export interface LegacyI19ParseResult {
  readonly rows: readonly LegacyI19Row[];
  readonly errors: readonly string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{2}:\d{2})(?::(\d{2}))?$/;
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/** Comma-decimal (the legacy export's format) → a plain base-10 decimal string. */
function toDecimal(value: string): string | null {
  const normalized = value
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  return normalized.length > 0 && DECIMAL.test(normalized) ? normalized : null;
}

/** `date` + `time` → a full ISO instant, or null when either part is unusable. */
function toOccurredAt(date: string, time: string): string | null {
  const trimmedDate = date.trim();
  if (!ISO_DATE.test(trimmedDate)) {
    return null;
  }
  const clock = CLOCK.exec(time.trim());
  if (clock === null) {
    return null;
  }
  const seconds = clock[2] ?? "00";
  const instant = `${trimmedDate}T${clock[1]}:${seconds}Z`;
  return Number.isNaN(Date.parse(instant)) ? null : instant;
}

function looksLikeHeader(cells: readonly string[]): boolean {
  const first = cells[0]?.trim().toLowerCase() ?? "";
  return first === "date" || first === "dato";
}

/**
 * Parses pasted legacy rows. Blank lines are skipped; a leading header row
 * (`date;…` / `Dato;…`) is skipped; every other line must have exactly
 * `LEGACY_I19_COLUMNS.length` cells with a usable date/time and decimals. A bad
 * line produces an error and **no** row (the caller decides whether to abort);
 * valid lines are returned with their physical line number as `sourceRowNo`.
 */
export function parseLegacyI19Rows(text: string): LegacyI19ParseResult {
  const rows: LegacyI19Row[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const sourceRowNo = index + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    const cells = line.split(";").map((cell) => cell.trim());
    if (looksLikeHeader(cells)) {
      return;
    }
    if (cells.length !== LEGACY_I19_COLUMNS.length) {
      errors.push(
        `Line ${sourceRowNo}: expected ${LEGACY_I19_COLUMNS.length} semicolon-separated columns, found ${cells.length}.`,
      );
      return;
    }

    // Columns are positional (`LEGACY_I19_COLUMNS`); `receipt` and `staff` are
    // carried in `raw` only, so they are read from `cells` when building it.
    const date = cells[0] ?? "";
    const time = cells[1] ?? "";
    const product = cells[4] ?? "";
    const variant = cells[5] ?? "";
    const location = cells[10] ?? "";

    const occurredAt = toOccurredAt(date, time);
    if (occurredAt === null) {
      errors.push(`Line ${sourceRowNo}: date/time is not a usable ISO date + clock.`);
      return;
    }
    const normalizedQuantity = toDecimal(cells[6] ?? "");
    const normalizedGross = toDecimal(cells[7] ?? "");
    const normalizedDiscount = toDecimal(cells[8] ?? "");
    const normalizedTotal = toDecimal(cells[9] ?? "");
    if (
      normalizedQuantity === null ||
      normalizedGross === null ||
      normalizedDiscount === null ||
      normalizedTotal === null
    ) {
      errors.push(
        `Line ${sourceRowNo}: quantity, price, discount and line total must be decimals.`,
      );
      return;
    }

    const raw: Record<string, string> = {};
    LEGACY_I19_COLUMNS.forEach((column, cellIndex) => {
      raw[column] = cells[cellIndex] ?? "";
    });

    // `external_id` is the product name: the legacy export's SKU column is
    // empty, so the mapping falls back to the external id (DEC-041). `product`
    // and `variant` are kept for the review summary.
    const normalized: Record<string, unknown> = {
      occurred_at: occurredAt,
      currency: LEGACY_I19_CURRENCY,
      gross_amount: normalizedTotal,
      quantity: normalizedQuantity,
      external_id: product,
      location_external_id: location,
      product,
      variant,
      gross_price: normalizedGross,
      discount: normalizedDiscount,
      line_total: normalizedTotal,
    };

    rows.push({ sourceRowNo, raw, normalized });
  });

  return { rows, errors };
}

/**
 * The canonical text of the demo legacy export used by the operator seed. Kept
 * here (not in the seed) so the seed and any manual smoke test paste the exact
 * same reference rows through `parseLegacyI19Rows`.
 */
export const LEGACY_I19_DEMO_TEXT = [
  LEGACY_I19_COLUMNS.join(";"),
  "2026-08-01;12:15:00;R-1001;Paulo Nicioli Paes;Demo Espresso Beans;250g;1;129,00;0,00;129,00;Aquarela Kongens Gate",
  "2026-08-01;12:16:30;R-1001;Paulo Nicioli Paes;Demo Decaf Beans;250g;2;129,00;10,00;248,00;Aquarela Kongens Gate",
  "2026-08-02;09:05:00;R-1002;Paulo Nicioli Paes;Demo Espresso Beans;250g;1;129,00;0,00;129,00;Aquarela Tullinløkka",
  "2026-08-02;09:06:00;R-1002;Paulo Nicioli Paes;Retired Legacy Widget;;1;49,00;0,00;49,00;Aquarela Tullinløkka",
].join("\n");
