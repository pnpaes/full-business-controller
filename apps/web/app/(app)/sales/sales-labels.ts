/**
 * Presentation helpers for the row-12 sales/reconciliation screens
 * (08_UI_UX.md §8.3–§8.5). Kept free of Next/DB/persistence imports so any
 * screen or client component can reuse them; the vocabularies mirror
 * `RECONCILIATION_STATUS`/`OPTION_KIND` without importing the application
 * bundle (the import-labels convention).
 */

export type SalesTone = "info" | "success" | "warning" | "danger";

/** `reconciliation.status` → pill tone/label (`REC-001`/`005`). */
export const RECONCILIATION_STATUS_VIEW: Record<string, { tone: SalesTone; label: string }> = {
  pending: { tone: "info", label: "Pending" },
  within_tolerance: { tone: "success", label: "Within tolerance" },
  exception: { tone: "danger", label: "Exception" },
  resolved: { tone: "success", label: "Resolved" },
  approved: { tone: "success", label: "Approved" },
};

export function reconciliationStatusView(status: string): { tone: SalesTone; label: string } {
  return RECONCILIATION_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `sales_line.option_kind` → label (`DEC-043`). */
export const OPTION_KIND_VIEW: Record<string, string> = {
  standalone: "Standalone",
  attached: "Attached add-on",
  included: "Included (zero-price)",
};

export function optionKindView(kind: string): string {
  return OPTION_KIND_VIEW[kind] ?? kind;
}

/**
 * The `DEC-026` sales/settlement tolerance is `max(0.5%, 5 NOK)`; the per-row
 * snapshot is shown as stored, and this label names the published default the
 * caller opted into when a reconciliation was created with it. There is no
 * tolerance-configuration table (recorded open point), so nothing is re-derived.
 */
export const TOLERANCE_DECISION_LABEL = "per-row snapshot (DEC-026; no config table)";

/** `true` when a reconciliation can still be resolved here. */
export function isOpenReconciliation(status: string): boolean {
  return status === "pending" || status === "exception" || status === "within_tolerance";
}
