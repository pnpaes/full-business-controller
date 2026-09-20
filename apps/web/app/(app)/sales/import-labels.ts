/**
 * Presentation helpers for the sales import screens (08_UI_UX.md §8.3, §8.6).
 * Kept free of Next/DB/persistence imports so any screen or table can reuse
 * them; the status/mapping vocabularies mirror `IMPORT_STATUS`/`MAPPING_STATE`
 * without importing the application bundle, so a client component can use them
 * too (the production screens' label module follows the same convention).
 */

export type ImportTone = "info" | "success" | "warning" | "danger";

/** Import-run status → pill tone/label (`uploaded` → `superseded`). */
export const IMPORT_STATUS_VIEW: Record<string, { tone: ImportTone; label: string }> = {
  uploaded: { tone: "info", label: "Uploaded" },
  parsed: { tone: "info", label: "Parsed" },
  needs_review: { tone: "warning", label: "Needs review" },
  validated: { tone: "success", label: "Validated" },
  posted: { tone: "success", label: "Posted" },
  partially_posted: { tone: "warning", label: "Partially posted" },
  failed: { tone: "danger", label: "Failed" },
  superseded: { tone: "info", label: "Superseded" },
};

export function importStatusView(status: string): { tone: ImportTone; label: string } {
  return IMPORT_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** Staging-row mapping state → pill tone/label. */
export const MAPPING_STATE_VIEW: Record<string, { tone: ImportTone; label: string }> = {
  unmapped: { tone: "warning", label: "Unmapped" },
  mapped: { tone: "success", label: "Mapped" },
  ignored: { tone: "info", label: "Ignored" },
  error: { tone: "danger", label: "Error" },
  conflict: { tone: "danger", label: "Conflict" },
};

export function mappingStateView(state: string): { tone: ImportTone; label: string } {
  return MAPPING_STATE_VIEW[state] ?? { tone: "info", label: state };
}

/** ISO instant → "2026-08-01 12:15 UTC". */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Two `yyyy-mm-dd` dates → "2026-08-01 → 2026-08-31". */
export function formatPeriod(start: string, end: string): string {
  return `${start} → ${end}`;
}

export function orDash(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

export interface MoneyTotalEntry {
  readonly currency: string;
  readonly amount: string;
}

/**
 * Turns a per-currency totals record into sorted entries. An empty record is a
 * real "nothing recorded" (slice 11 never posts), so the caller can render an
 * empty state rather than inventing a zero row.
 */
export function moneyTotalEntries(
  totals: Readonly<Record<string, string>> | null,
): readonly MoneyTotalEntry[] {
  if (totals === null) {
    return [];
  }
  return Object.entries(totals)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount }));
}
