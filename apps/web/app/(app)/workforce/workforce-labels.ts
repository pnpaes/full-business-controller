/**
 * Presentation helpers for the workforce screens (employees, roster, worked
 * hours, payroll reports — `WF-001`…`WF-007`). Kept free of Next/DB/persistence
 * imports so the server pages and their client components can reuse them; the
 * vocabularies mirror the application constants (`SHIFT_STATES`,
 * `PAYROLL_REPORT_STATUSES`, `EMPLOYMENT_TYPES`, `EMPLOYEE_DOCUMENT_KINDS`)
 * without importing the application bundle (the `close-labels.ts` precedent).
 */

export type StatusTone = "info" | "success" | "warning" | "danger";

/** `shift_state` → pill tone/label (`DEC-102`). */
export const SHIFT_STATE_VIEW: Record<string, { tone: StatusTone; label: string }> = {
  open: { tone: "info", label: "Open" },
  published: { tone: "info", label: "Published" },
  assigned: { tone: "warning", label: "Assigned" },
  cancelled: { tone: "danger", label: "Cancelled" },
  completed: { tone: "success", label: "Completed" },
};

export function shiftStateView(state: string): { tone: StatusTone; label: string } {
  return SHIFT_STATE_VIEW[state] ?? { tone: "info", label: state };
}

/** `shift_assignment_state` → pill tone/label (`DEC-102`; only `approved`/`withdrawn` are reachable). */
export const ASSIGNMENT_STATE_VIEW: Record<string, { tone: StatusTone; label: string }> = {
  approved: { tone: "success", label: "Approved" },
  withdrawn: { tone: "danger", label: "Withdrawn" },
  self_assigned: { tone: "warning", label: "Self-assigned" },
  pending_approval: { tone: "warning", label: "Pending approval" },
  rejected: { tone: "danger", label: "Rejected" },
};

export function assignmentStateView(state: string): { tone: StatusTone; label: string } {
  return ASSIGNMENT_STATE_VIEW[state] ?? { tone: "info", label: state };
}

/** `payroll_report_status` → pill tone/label (`DEC-104`). */
export const PAYROLL_STATUS_VIEW: Record<string, { tone: StatusTone; label: string }> = {
  draft: { tone: "info", label: "Draft" },
  generated: { tone: "info", label: "Generated" },
  exported: { tone: "success", label: "Exported" },
  superseded: { tone: "warning", label: "Superseded" },
};

export function payrollStatusView(status: string): { tone: StatusTone; label: string } {
  return PAYROLL_STATUS_VIEW[status] ?? { tone: "info", label: status };
}

/** `employment_type` → label. */
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
};

export function employmentTypeLabel(value: string): string {
  return EMPLOYMENT_TYPE_LABELS[value] ?? value;
}

/** `employee_document_kind` → label. */
export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  id_document: "ID document",
  other: "Other",
};

export function documentKindLabel(kind: string): string {
  return DOCUMENT_KIND_LABELS[kind] ?? kind;
}

/** ISO instant → "2026-09-24 09:00 UTC" (the read is at the request time). */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** A shift's window as "2026-09-24 09:00 → 17:00 UTC" (same-day) or with both dates. */
export function formatShiftWindow(startsAt: string, endsAt: string): string {
  const startDay = startsAt.slice(0, 10);
  const endDay = endsAt.slice(0, 10);
  const start = startsAt.slice(11, 16);
  const end = endsAt.slice(11, 16);
  return startDay === endDay
    ? `${startDay} ${start} → ${end} UTC`
    : `${startsAt.slice(0, 16).replace("T", " ")} → ${endsAt.slice(0, 16).replace("T", " ")} UTC`;
}

/** The UTC calendar day an ISO instant falls on (`YYYY-MM-DD`). */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Today's UTC day as `YYYY-MM-DD` (the roster/hours default window anchor). */
export function todayUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the day's first instant as an ISO string (UTC). */
export function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** `YYYY-MM-DD` → the day's last instant as an ISO string (UTC; inclusive bound). */
export function dayEndIso(day: string): string {
  return `${day}T23:59:59.999Z`;
}

/** `YYYY-MM-DD` → the next day (`YYYY-MM-DD`), UTC. */
export function nextUtcDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The first day of `day`'s UTC month (`YYYY-MM-DD`). */
export function monthStartUtcDay(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The last day of `day`'s UTC month (`YYYY-MM-DD`). */
export function monthEndUtcDay(day: string): string {
  const year = Number.parseInt(day.slice(0, 4), 10);
  const month = Number.parseInt(day.slice(5, 7), 10);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/* ----------------------------- payroll snapshot ---------------------------- */

/** One frozen per-employee line of a payroll snapshot (`DEC-104` item 1). */
export interface PayrollSnapshotLine {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleCode: string;
  readonly hours: string;
  readonly hourlyRate: string;
  readonly expectedPay: string;
}

/** The frozen snapshot shape (`DEC-104` item 1); all money/hours are decimal strings. */
export interface PayrollSnapshot {
  readonly schemaVersion: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lines: readonly PayrollSnapshotLine[];
  readonly totalHours: string;
  readonly totalExpectedPay: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Defensively parses a `payroll_report.snapshot` (`DEC-104` item 1). Returns
 * `null` for anything that is not the documented shape — the UI then says the
 * snapshot is unreadable rather than inventing numbers. Decimal strings are
 * required (a JSON number in a money field is treated as malformed, never
 * coerced).
 */
export function parsePayrollSnapshot(snapshot: unknown): PayrollSnapshot | null {
  if (!isRecord(snapshot)) {
    return null;
  }
  const schemaVersion = snapshot["schemaVersion"];
  const currency = asString(snapshot["currency"]);
  const periodStart = asString(snapshot["periodStart"]);
  const periodEnd = asString(snapshot["periodEnd"]);
  const totalHours = asString(snapshot["totalHours"]);
  const totalExpectedPay = asString(snapshot["totalExpectedPay"]);
  if (
    typeof schemaVersion !== "number" ||
    currency === null ||
    periodStart === null ||
    periodEnd === null ||
    totalHours === null ||
    totalExpectedPay === null ||
    !Array.isArray(snapshot["lines"])
  ) {
    return null;
  }
  const lines: PayrollSnapshotLine[] = [];
  for (const raw of snapshot["lines"]) {
    if (!isRecord(raw)) {
      return null;
    }
    const employeeId = asString(raw["employeeId"]);
    const employeeName = asString(raw["employeeName"]);
    const roleCode = asString(raw["roleCode"]);
    const hours = asString(raw["hours"]);
    const hourlyRate = asString(raw["hourlyRate"]);
    const expectedPay = asString(raw["expectedPay"]);
    if (
      employeeId === null ||
      employeeName === null ||
      roleCode === null ||
      hours === null ||
      hourlyRate === null ||
      expectedPay === null
    ) {
      return null;
    }
    lines.push({ employeeId, employeeName, roleCode, hours, hourlyRate, expectedPay });
  }
  return { schemaVersion, currency, periodStart, periodEnd, lines, totalHours, totalExpectedPay };
}
