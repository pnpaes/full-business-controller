/**
 * Presentation helpers for the HMS section (`HMS-001…007`, `DEC-089`–`DEC-093`).
 * Kept free of Next/DB/persistence imports so server pages and client forms can
 * reuse them; the vocabularies mirror the persistence enums (`MONITORING_POINT_KIND`,
 * `CHECK_FREQUENCY`, `INCIDENT_*`, `CORRECTIVE_ACTION_STATUS`, `CHECKLIST_*`,
 * `MAINTENANCE_KIND`) without importing the application bundle (the
 * `close-labels.ts` precedent). Unknown values fall back to the raw code so a
 * later vocabulary widening degrades to honest text, never a crash.
 */

export type HmsTone = "info" | "success" | "warning" | "danger";

/** `incident_status` → pill tone/label (`DEC-090`). */
export const INCIDENT_STATUS_VIEW: Record<string, { tone: HmsTone; label: string }> = {
  open: { tone: "danger", label: "Open" },
  investigating: { tone: "warning", label: "Investigating" },
  resolved: { tone: "info", label: "Resolved" },
  closed: { tone: "success", label: "Closed" },
};

export function incidentStatusView(status: string): { tone: HmsTone; label: string } {
  return INCIDENT_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `incident_severity` → pill tone/label (`DEC-095`). */
export const INCIDENT_SEVERITY_VIEW: Record<string, { tone: HmsTone; label: string }> = {
  low: { tone: "info", label: "Low" },
  medium: { tone: "warning", label: "Medium" },
  high: { tone: "danger", label: "High" },
  critical: { tone: "danger", label: "Critical" },
};

export function incidentSeverityView(severity: string): { tone: HmsTone; label: string } {
  return INCIDENT_SEVERITY_VIEW[severity] ?? { tone: "info", label: severity };
}

/** `incident_category` → label (`DEC-090`). */
export const INCIDENT_CATEGORY_LABELS: Record<string, string> = {
  work_accident: "Work accident",
  electrical: "Electrical",
  equipment: "Equipment",
  fire: "Fire",
  near_miss: "Near miss",
  other: "Other",
};

export function incidentCategoryLabel(category: string): string {
  return INCIDENT_CATEGORY_LABELS[category] ?? category;
}

/** `corrective_action_status` → pill tone/label (`DEC-090`). */
export const CORRECTIVE_ACTION_STATUS_VIEW: Record<string, { tone: HmsTone; label: string }> = {
  open: { tone: "warning", label: "Open" },
  in_progress: { tone: "info", label: "In progress" },
  done: { tone: "info", label: "Done" },
  verified: { tone: "success", label: "Verified" },
};

export function correctiveActionStatusView(status: string): { tone: HmsTone; label: string } {
  return CORRECTIVE_ACTION_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `checklist_run_status` → pill tone/label (`DEC-091`). */
export const CHECKLIST_RUN_STATUS_VIEW: Record<string, { tone: HmsTone; label: string }> = {
  in_progress: { tone: "warning", label: "In progress" },
  completed: { tone: "success", label: "Completed" },
};

export function checklistRunStatusView(status: string): { tone: HmsTone; label: string } {
  return CHECKLIST_RUN_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `checklist_category` → label (`DEC-091`). */
export const CHECKLIST_CATEGORY_LABELS: Record<string, string> = {
  opening: "Opening",
  closing: "Closing",
  cleaning: "Cleaning",
  hygiene: "Hygiene",
  food_safety: "Food safety",
  other: "Other",
};

export function checklistCategoryLabel(category: string): string {
  return CHECKLIST_CATEGORY_LABELS[category] ?? category;
}

/** `checklist_item_outcome` → pill tone/label (`DEC-096`). */
export const CHECKLIST_OUTCOME_VIEW: Record<string, { tone: HmsTone; label: string }> = {
  pass: { tone: "success", label: "Pass" },
  fail: { tone: "danger", label: "Fail" },
  not_applicable: { tone: "info", label: "N/A" },
};

export function checklistOutcomeView(outcome: string): { tone: HmsTone; label: string } {
  return CHECKLIST_OUTCOME_VIEW[outcome] ?? { tone: "info", label: outcome };
}

/** `monitoring_point_kind` → label (`DEC-089`). */
export const MONITORING_POINT_KIND_LABELS: Record<string, string> = {
  refrigerator: "Refrigerator",
  freezer: "Freezer",
  cooler: "Cooler",
  hot_holding: "Hot holding",
  other: "Other",
};

export function monitoringPointKindLabel(kind: string): string {
  return MONITORING_POINT_KIND_LABELS[kind] ?? kind;
}

/** `check_frequency` → label (`DEC-089`, shared with the checklist cadence). */
export const CHECK_FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  twice_daily: "Twice daily",
  weekly: "Weekly",
  monthly: "Monthly",
  other: "Other",
};

export function checkFrequencyLabel(frequency: string): string {
  return CHECK_FREQUENCY_LABELS[frequency] ?? frequency;
}

/** `maintenance_kind` → label (`DEC-092`). */
export const MAINTENANCE_KIND_LABELS: Record<string, string> = {
  service: "Service",
  repair: "Repair",
  inspection: "Inspection",
};

export function maintenanceKindLabel(kind: string): string {
  return MAINTENANCE_KIND_LABELS[kind] ?? kind;
}

/** ISO instant → "2026-09-20 12:42 UTC" (the read is at the request time). */
export function formatHmsInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** ISO instant → "2026-09-20" (a `date` column crossing). */
export function formatHmsDay(day: string | null): string {
  return day ?? "—";
}

/**
 * The freshness window a point's `check_frequency` implies, in hours, used by
 * the monitoring log's overdue cue. A presentation heuristic only — the backend
 * records no due instant (`DEC-089` has no scheduling), so "overdue" here means
 * "no reading within the cadence window". `other` has no window.
 */
export function frequencyWindowHours(checkFrequency: string): number | null {
  switch (checkFrequency) {
    case "twice_daily":
      return 12;
    case "daily":
      return 24;
    case "weekly":
      return 24 * 7;
    case "monthly":
      return 24 * 31;
    default:
      return null;
  }
}

/** Human age of an ISO instant relative to now, coarse ("3 h ago", "2 d ago"). */
export function formatAge(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) {
    return "just now";
  }
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return minutes <= 1 ? "just now" : `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  return `${Math.floor(hours / 24)} d ago`;
}

/** One parsed `checklist_template.items` element (`DEC-096`, provisional shape). */
export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

/**
 * Reads a template's jsonb `items` defensively: non-objects or blank
 * `key`/`label` are skipped (the command validated shape at write time; this is
 * the read-side guard so a malformed legacy row cannot crash the run form).
 */
export function parseChecklistItems(items: unknown): readonly ChecklistItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const parsed: ChecklistItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.trim().length === 0) {
      continue;
    }
    if (typeof record.label !== "string" || record.label.trim().length === 0) {
      continue;
    }
    parsed.push({
      key: record.key,
      label: record.label,
      required: record.required === true,
    });
  }
  return parsed;
}

/** One parsed `checklist_run.results` element (`DEC-096`). */
export interface ChecklistResult {
  readonly key: string;
  readonly outcome: string;
  readonly note?: string;
}

/** Reads a run's jsonb `results` with the same defensive shape as the items. */
export function parseChecklistResults(results: unknown): readonly ChecklistResult[] {
  if (!Array.isArray(results)) {
    return [];
  }
  const parsed: ChecklistResult[] = [];
  for (const result of results) {
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      continue;
    }
    const record = result as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.trim().length === 0) {
      continue;
    }
    if (typeof record.outcome !== "string") {
      continue;
    }
    parsed.push({
      key: record.key,
      outcome: record.outcome,
      ...(typeof record.note === "string" && record.note.length > 0 ? { note: record.note } : {}),
    });
  }
  return parsed;
}
