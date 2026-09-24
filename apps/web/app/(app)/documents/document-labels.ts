/**
 * Presentation helpers for the staff document library (`DEC-088`,
 * `DOC-001`…`DOC-004`). Kept free of Next/DB/persistence imports so the pages
 * and their client components can reuse them; the vocabularies mirror
 * `DOCUMENT_CATEGORY`/`DOCUMENT_AUDIENCE`/`STAFF_DOCUMENT_STATUS` without
 * importing the application bundle (the `close-labels.ts` precedent).
 */

export type DocumentTone = "info" | "success" | "warning" | "danger";

/** `staff_document_status` → pill tone/label (`DEC-088`). */
export const DOCUMENT_STATUS_VIEW: Record<string, { tone: DocumentTone; label: string }> = {
  draft: { tone: "info", label: "Draft" },
  published: { tone: "success", label: "Published" },
  archived: { tone: "warning", label: "Archived" },
};

export function documentStatusView(status: string): { tone: DocumentTone; label: string } {
  return DOCUMENT_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `document_category` → label (`DEC-088`). */
export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  routine: "Routine",
  guideline: "Guideline",
  policy: "Policy",
  form: "Form",
  other: "Other",
};

export function documentCategoryLabel(category: string): string {
  return DOCUMENT_CATEGORY_LABELS[category] ?? category;
}

/** `document_audience` → label (`DEC-088`). */
export const DOCUMENT_AUDIENCE_LABELS: Record<string, string> = {
  all_staff: "All staff",
  managers: "Managers",
};

export function documentAudienceLabel(audience: string): string {
  return DOCUMENT_AUDIENCE_LABELS[audience] ?? audience;
}

/** ISO instant → "2026-09-20 12:42 UTC" (the read is at the request time). */
export function formatDocumentInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
