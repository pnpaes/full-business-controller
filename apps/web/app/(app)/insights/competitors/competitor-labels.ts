/**
 * Presentation labels for the competitor screens (`DEC-126`). Pure and
 * dependency-free so the page, the filter chips and the row controls share one
 * vocabulary and a test can pin it.
 *
 * The review-status view makes the `DEC-020` posture visible: `pending` is
 * styled as a warning ("not intelligence") and never as a result, `reviewed` is
 * the only status that reads as intelligence, and `rejected` is a settled "no".
 */

export type CompetitorTone = "info" | "success" | "warning" | "danger";

export interface ReviewStatusView {
  readonly label: string;
  readonly tone: CompetitorTone;
  readonly description: string;
}

export const COMPETITOR_REVIEW_STATUS_VIEW: Record<string, ReviewStatusView> = {
  pending: {
    label: "Pending",
    tone: "warning",
    description: "Captured, not reviewed — not intelligence until reviewed.",
  },
  reviewed: {
    label: "Reviewed",
    tone: "success",
    description: "Reviewed and admitted as intelligence.",
  },
  rejected: {
    label: "Rejected",
    tone: "info",
    description: "Reviewed and set aside — never intelligence.",
  },
};

export function reviewStatusView(status: string): ReviewStatusView {
  return (
    COMPETITOR_REVIEW_STATUS_VIEW[status] ?? {
      label: status,
      tone: "info",
      description: "Unknown review status.",
    }
  );
}

/** The filter chips on the observation register, in display order. */
export const COMPETITOR_STATUS_FILTERS = ["pending", "reviewed", "rejected", "all"] as const;

export function statusFilterLabel(status: string): string {
  return status === "all" ? "All" : reviewStatusView(status).label;
}

/** Why a reviewed observation was reported as not comparable. */
export const COMPARISON_REASON_LABEL: Record<string, string> = {
  no_item: "No comparable item on the observation",
  no_competitor_price: "No competitor price recorded",
  no_product_variant: "No product variant for that item",
  no_effective_price: "No effective price of ours at the observation date",
  currency_mismatch: "Stated in a different currency",
};

export function comparisonReasonLabel(reason: string): string {
  return COMPARISON_REASON_LABEL[reason] ?? reason;
}

/** `2026-03-05T09:30:00.000Z` → `2026-03-05`. */
export function formatDay(instant: string): string {
  return instant.slice(0, 10);
}

/** `2026-03-05T09:30:00.000Z` → `2026-03-05 09:30 UTC`. */
export function formatInstantUTC(instant: string): string {
  return `${instant.slice(0, 16).replace("T", " ")} UTC`;
}

/** A `YYYY-MM-DD` day as the UTC instant that opens it. */
export function dayStartInstant(day: string): string {
  return `${day}T00:00:00.000Z`;
}
