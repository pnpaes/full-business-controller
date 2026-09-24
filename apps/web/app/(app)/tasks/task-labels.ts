/**
 * Presentation helpers for the task register (`DEC-122`). Kept free of
 * Next/DB/persistence imports so the page and its client components can reuse
 * them; the vocabulary is the one the `task_status_check` constraint stores
 * (`open`, `in_progress`, `blocked`, `resolved`, `dismissed`), mirrored here
 * without importing the application bundle (the `close-labels.ts` precedent).
 *
 * `task.type` and `task.priority` are free text with no vocabulary (`DEC-101`),
 * so the priority view only labels the common values a picker offers and falls
 * back to the raw string — it never rejects a stored value.
 */

export type TaskTone = "info" | "success" | "warning" | "danger";

/** The stored `task.status` → pill tone/label (`DEC-122`). */
export const TASK_STATUS_VIEW: Record<string, { tone: TaskTone; label: string }> = {
  open: { tone: "info", label: "Open" },
  in_progress: { tone: "warning", label: "In progress" },
  blocked: { tone: "danger", label: "Blocked" },
  resolved: { tone: "success", label: "Resolved" },
  dismissed: { tone: "info", label: "Dismissed" },
};

export function taskStatusView(status: string): { tone: TaskTone; label: string } {
  return TASK_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** The common priority values → tone/label; an unlisted free-text value passes through. */
export const TASK_PRIORITY_VIEW: Record<string, { tone: TaskTone; label: string }> = {
  low: { tone: "info", label: "Low" },
  normal: { tone: "info", label: "Normal" },
  high: { tone: "warning", label: "High" },
  urgent: { tone: "danger", label: "Urgent" },
};

export function taskPriorityView(priority: string): { tone: TaskTone; label: string } {
  return TASK_PRIORITY_VIEW[priority] ?? { tone: "info", label: priority };
}

/**
 * The legal `from -> to` transitions, mirroring the application machine
 * (`TASK_STATUS_TRANSITIONS`) so the row buttons offer exactly the targets the
 * server will accept. `resolved`/`dismissed` are terminal (empty lists); an
 * unknown current status is absent and so offers no action.
 */
export const TASK_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["in_progress", "blocked", "dismissed"],
  in_progress: ["resolved", "blocked", "dismissed"],
  blocked: ["in_progress", "dismissed"],
  resolved: [],
  dismissed: [],
};

/** The legal transition targets for a row's current status (empty when terminal/unknown). */
export function taskAllowedTargets(status: string): readonly string[] {
  return TASK_STATUS_TRANSITIONS[status] ?? [];
}

/** The button label for each transition target status. */
export const TASK_ACTION_LABELS: Record<string, string> = {
  in_progress: "Start",
  blocked: "Block",
  resolved: "Resolve",
  dismissed: "Dismiss",
};

export function taskActionLabel(target: string): string {
  return TASK_ACTION_LABELS[target] ?? target;
}

/** True when `status` is terminal (`resolved`/`dismissed`); the UI's copy of the machine. */
export function isTerminalTaskStatus(status: string): boolean {
  return status === "resolved" || status === "dismissed";
}

/** `date`, `YYYY-MM-DD`, or an em dash when unset. */
export function formatTaskDay(day: string | null): string {
  return day ?? "—";
}

/** ISO instant → "2026-09-24 09:00 UTC". */
export function formatTaskInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * A due-date cue for a row: `overdue` (danger), `today` (warning), `upcoming`
 * (info) or null when the task has no due date or is terminal (a resolved or
 * dismissed task is not "overdue"). The comparison is day-granular on
 * `YYYY-MM-DD` strings, so it needs no timezone maths; `today` is passed in so
 * the helper stays pure.
 */
export function taskDueView(
  dueDate: string | null,
  today: string,
  status: string,
): { tone: TaskTone; label: string } | null {
  if (dueDate === null || isTerminalTaskStatus(status)) {
    return null;
  }
  if (dueDate < today) {
    return { tone: "danger", label: "Overdue" };
  }
  if (dueDate === today) {
    return { tone: "warning", label: "Due today" };
  }
  return { tone: "info", label: "Upcoming" };
}
