/**
 * Presentation helpers for the AI-advisory review queue (`ADR-0009`, `DEC-142`,
 * row 17). Kept free of Next/DB imports so the server page and the client
 * register can share them (the `jobs-labels.ts` precedent). The suggestion
 * state vocabulary mirrors `AI_SUGGESTION_STATE`.
 */

export type AiTone = "info" | "success" | "warning" | "danger";

/** `ai_suggestion.state` → pill tone/label. */
export const AI_STATE_VIEW: Record<string, { tone: AiTone; label: string }> = {
  proposed: { tone: "warning", label: "Proposed" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
  superseded: { tone: "info", label: "Superseded" },
};

export function aiStateView(state: string): { tone: AiTone; label: string } {
  return AI_STATE_VIEW[state] ?? { tone: "info", label: state };
}

/** The review filter order; `proposed` leads (the queue). */
export const AI_STATE_FILTERS = ["proposed", "approved", "rejected", "superseded"] as const;

export function isAiState(value: string): boolean {
  return Object.hasOwn(AI_STATE_VIEW, value);
}

/** A `timestamptz` (Date or ISO string) → "2026-09-27 08:15 UTC"; null → "—". */
export function formatAiInstant(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Model output is untrusted: render it as plain text only. Prefer string
 * `title`/`body` fields when present, else a bounded stringified fallback.
 */
export function suggestionText(suggestion: Record<string, unknown>): string {
  const title = typeof suggestion.title === "string" ? suggestion.title.trim() : "";
  const body = typeof suggestion.body === "string" ? suggestion.body.trim() : "";
  if (title.length > 0 || body.length > 0) {
    return body.length > 0 ? `${title}${title.length > 0 ? " — " : ""}${body}` : title;
  }
  let json: string;
  try {
    json = JSON.stringify(suggestion);
  } catch {
    json = "[unrenderable]";
  }
  return json.length > 400 ? `${json.slice(0, 400)}…` : json;
}
