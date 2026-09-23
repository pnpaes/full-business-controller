/**
 * Presentation helpers for the close register (`DEC-119`, `REC-003`/`REC-006`).
 * Kept free of Next/DB/persistence imports so the page and its client components
 * can reuse them; the vocabularies mirror `PERIOD_CLOSE_STATUSES`/
 * `PERIOD_CLOSE_SCOPE_TYPES` without importing the application bundle (the
 * `sales-labels.ts` precedent).
 */

export type CloseTone = "info" | "success" | "warning" | "danger";

/** `period_close_status` → pill tone/label (`DEC-027`). */
export const CLOSE_STATUS_VIEW: Record<string, { tone: CloseTone; label: string }> = {
  open: { tone: "info", label: "Open" },
  closing: { tone: "warning", label: "Closing" },
  locked: { tone: "success", label: "Locked" },
  reopened: { tone: "warning", label: "Reopened" },
};

export function closeStatusView(status: string): { tone: CloseTone; label: string } {
  return CLOSE_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `period_close_scope_type` → label (`DEC-027`). */
export const CLOSE_SCOPE_LABELS: Record<string, string> = {
  location: "Location",
  company: "Company",
};

export function closeScopeLabel(scopeType: string): string {
  return CLOSE_SCOPE_LABELS[scopeType] ?? scopeType;
}

/**
 * A single day when `periodStart === periodEnd` (a location daily close), else the
 * inclusive range (a company month close, `resolveClosePeriod`).
 */
export function formatClosePeriod(periodStart: string, periodEnd: string): string {
  return periodStart === periodEnd ? periodStart : `${periodStart} → ${periodEnd}`;
}

/** ISO instant → "2026-09-20 12:42 UTC" (the read is at the request time). */
export function formatCloseInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
