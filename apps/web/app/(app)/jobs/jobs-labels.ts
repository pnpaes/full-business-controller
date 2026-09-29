/**
 * Presentation helpers for the jobs operator screen (`DEC-139`). Kept free of
 * Next/DB/persistence imports so the server page and the client register can
 * both reuse them; the `job` status vocabulary mirrors `JOB_STATUS` without
 * importing the application bundle (the `close-labels.ts` precedent).
 */

export type JobTone = "info" | "success" | "warning" | "danger";

/** The five `job_status_check` values → pill tone/label. */
export const JOB_STATUS_VIEW: Record<string, { tone: JobTone; label: string }> = {
  pending: { tone: "info", label: "Pending" },
  running: { tone: "warning", label: "Running" },
  succeeded: { tone: "success", label: "Succeeded" },
  failed: { tone: "danger", label: "Failed" },
  dead_lettered: { tone: "danger", label: "Dead-lettered" },
};

export function jobStatusView(status: string): { tone: JobTone; label: string } {
  return JOB_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** The filter order for the screen; `dead_lettered` leads (the review queue). */
export const JOB_STATUS_FILTERS = [
  "dead_lettered",
  "failed",
  "running",
  "pending",
  "succeeded",
] as const;

export function isJobStatus(value: string): boolean {
  return Object.hasOwn(JOB_STATUS_VIEW, value);
}

/** A `timestamptz` instant (Date from persistence, or an ISO string) → "… UTC". */
export function formatJobInstant(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** A plain relative age ("just now", "5m", "3h", "2d") for freshness lines. */
export function formatJobAge(value: Date | string, now: Date = new Date()): string {
  const created = typeof value === "string" ? new Date(value) : value;
  const minutes = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
