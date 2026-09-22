import { describe, expect, it } from "vitest";

import { PAYROLL_SNAPSHOT_VERSION, buildPayrollSnapshot, isPayrollReportStatus } from "./payroll";

describe("buildPayrollSnapshot", () => {
  it("computes expected pay as hours × rate at money scale, HALF_UP", () => {
    // 0.25 × 0.0002 = 0.00005 → HALF_UP at 4 dp → 0.0001 (half away from zero).
    // 0.25 × 0.0001 = 0.000025 → 4 dp → 0.0000 (below half).
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          employeeId: "employee-1",
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "0.25",
          hourlyRate: "0.0002",
        },
        {
          employeeId: "employee-2",
          employeeName: "Ola Olsen",
          roleCode: "kitchen",
          hours: "0.25",
          hourlyRate: "0.0001",
        },
      ],
    });

    expect(snapshot.lines.map((line) => line.expectedPay)).toEqual(["0.0001", "0.0000"]);
  });

  it("keeps a 4 dp rate and never leaks a float", () => {
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          employeeId: "employee-1",
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "1.10",
          hourlyRate: "215.5000",
        },
      ],
    });

    // 1.10 × 215.5000 = 237.0500 exactly; a float would drift.
    expect(snapshot.lines[0]).toEqual({
      employeeId: "employee-1",
      employeeName: "Nora Nordmann",
      roleCode: "barista",
      hours: "1.10",
      hourlyRate: "215.5000",
      expectedPay: "237.0500",
    });
    expect(typeof snapshot.lines[0]!.expectedPay).toBe("string");
  });

  it("orders lines by employee name, then employee id", () => {
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          employeeId: "employee-b",
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "1.00",
          hourlyRate: "200.0000",
        },
        {
          employeeId: "employee-z",
          employeeName: "Ana Andersen",
          roleCode: "barista",
          hours: "1.00",
          hourlyRate: "200.0000",
        },
        {
          employeeId: "employee-a",
          employeeName: "Nora Nordmann",
          roleCode: "kitchen",
          hours: "1.00",
          hourlyRate: "200.0000",
        },
      ],
    });

    expect(snapshot.lines.map((line) => line.employeeId)).toEqual([
      "employee-z",
      "employee-a",
      "employee-b",
    ]);
  });

  it("sums the totals at their own scales", () => {
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          employeeId: "employee-1",
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "6.50",
          hourlyRate: "200.0000",
        },
        {
          employeeId: "employee-2",
          employeeName: "Ola Olsen",
          roleCode: "kitchen",
          hours: "4.00",
          hourlyRate: "180.0000",
        },
      ],
    });

    expect(snapshot).toMatchObject({
      schemaVersion: PAYROLL_SNAPSHOT_VERSION,
      currency: "NOK",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      totalHours: "10.50",
      // 6.50 × 200 = 1300.0000; 4.00 × 180 = 720.0000.
      totalExpectedPay: "2020.0000",
    });
  });

  it("builds an empty report with zero totals", () => {
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [],
    });

    expect(snapshot.lines).toEqual([]);
    expect(snapshot.totalHours).toBe("0.00");
    expect(snapshot.totalExpectedPay).toBe("0.0000");
    expect(snapshot.currency).toBe("NOK");
  });

  it("keeps a zero-hours line with zero pay", () => {
    const snapshot = buildPayrollSnapshot({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          employeeId: "employee-1",
          employeeName: "Nora Nordmann",
          roleCode: "barista",
          hours: "0",
          hourlyRate: "215.5000",
        },
      ],
    });

    expect(snapshot.lines[0]).toMatchObject({ hours: "0.00", expectedPay: "0.0000" });
    expect(snapshot.totalHours).toBe("0.00");
    expect(snapshot.totalExpectedPay).toBe("0.0000");
  });
});

describe("isPayrollReportStatus", () => {
  it("accepts the four vocabulary values and rejects anything else", () => {
    for (const value of ["draft", "generated", "exported", "superseded"]) {
      expect(isPayrollReportStatus(value)).toBe(true);
    }
    for (const value of ["", "pending", "GENERATED", "closed"]) {
      expect(isPayrollReportStatus(value)).toBe(false);
    }
  });
});
