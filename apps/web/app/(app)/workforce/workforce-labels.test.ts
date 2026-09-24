import { describe, expect, it } from "vitest";

import {
  assignmentStateView,
  dayEndIso,
  dayStartIso,
  documentKindLabel,
  employmentTypeLabel,
  formatInstant,
  formatShiftWindow,
  monthStartUtcDay,
  nextUtcDay,
  parsePayrollSnapshot,
  payrollStatusView,
  shiftStateView,
  todayUtcDay,
  utcDay,
} from "./workforce-labels";

describe("workforce-labels", () => {
  it("maps every known shift state to a tone and label", () => {
    expect(shiftStateView("open")).toEqual({ tone: "info", label: "Open" });
    expect(shiftStateView("assigned")).toEqual({ tone: "warning", label: "Assigned" });
    expect(shiftStateView("completed")).toEqual({ tone: "success", label: "Completed" });
  });

  it("falls back to the raw value for an unknown state (no silent relabel)", () => {
    expect(shiftStateView("bogus")).toEqual({ tone: "info", label: "bogus" });
    expect(assignmentStateView("bogus")).toEqual({ tone: "info", label: "bogus" });
    expect(payrollStatusView("bogus")).toEqual({ tone: "info", label: "bogus" });
  });

  it("labels the employment types and document kinds, falling back to the raw value", () => {
    expect(employmentTypeLabel("full_time")).toBe("Full time");
    expect(employmentTypeLabel("seasonal")).toBe("seasonal");
    expect(documentKindLabel("certificate")).toBe("Certificate");
    expect(documentKindLabel("other")).toBe("Other");
  });

  it("formats an instant and a same-day shift window in UTC", () => {
    expect(formatInstant("2026-09-24T09:05:00.000Z")).toBe("2026-09-24 09:05 UTC");
    expect(formatShiftWindow("2026-09-24T09:00:00.000Z", "2026-09-24T17:00:00.000Z")).toBe(
      "2026-09-24 09:00 → 17:00 UTC",
    );
    expect(formatShiftWindow("2026-09-24T22:00:00.000Z", "2026-09-25T06:00:00.000Z")).toBe(
      "2026-09-24 22:00 → 2026-09-25 06:00 UTC",
    );
  });

  it("derives UTC day helpers", () => {
    expect(utcDay("2026-09-24T23:59:59.999Z")).toBe("2026-09-24");
    expect(dayStartIso("2026-09-24")).toBe("2026-09-24T00:00:00.000Z");
    expect(dayEndIso("2026-09-24")).toBe("2026-09-24T23:59:59.999Z");
    expect(nextUtcDay("2026-09-30")).toBe("2026-10-01");
    expect(monthStartUtcDay("2026-09-24")).toBe("2026-09-01");
    expect(todayUtcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("parses a well-formed payroll snapshot (DEC-104 shape, decimal strings)", () => {
    const snapshot = {
      schemaVersion: 1,
      currency: "NOK",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      lines: [
        {
          employeeId: "e1",
          employeeName: "Ada",
          roleCode: "barista",
          hours: "152.50",
          hourlyRate: "185.5000",
          expectedPay: "28196.0000",
        },
      ],
      totalHours: "152.50",
      totalExpectedPay: "28196.0000",
    };
    expect(parsePayrollSnapshot(snapshot)).toEqual({
      schemaVersion: 1,
      currency: "NOK",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      lines: [
        {
          employeeId: "e1",
          employeeName: "Ada",
          roleCode: "barista",
          hours: "152.50",
          hourlyRate: "185.5000",
          expectedPay: "28196.0000",
        },
      ],
      totalHours: "152.50",
      totalExpectedPay: "28196.0000",
    });
  });

  it("rejects a malformed snapshot instead of inventing numbers", () => {
    expect(parsePayrollSnapshot(null)).toBeNull();
    expect(parsePayrollSnapshot("nope")).toBeNull();
    expect(parsePayrollSnapshot({})).toBeNull();
    // A JSON number in a money field is malformed, never coerced.
    expect(
      parsePayrollSnapshot({
        schemaVersion: 1,
        currency: "NOK",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        lines: [
          {
            employeeId: "e1",
            employeeName: "Ada",
            roleCode: "barista",
            hours: 152.5,
            hourlyRate: "185.5000",
            expectedPay: "28196.0000",
          },
        ],
        totalHours: "152.50",
        totalExpectedPay: "28196.0000",
      }),
    ).toBeNull();
  });
});
