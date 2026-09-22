import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { deriveAssignmentHours, sumWorkedHoursByEmployee } from "./scheduling";
import type { WorkedHoursRow } from "./scheduling";

const row = (overrides: Partial<WorkedHoursRow> = {}): WorkedHoursRow => ({
  employeeId: "emp-1",
  employeeName: "Nora Nordmann",
  roleCode: "barista",
  startsAt: "2026-07-01T08:00:00.000Z",
  endsAt: "2026-07-01T16:00:00.000Z",
  breakMinutes: 0,
  adjustedHours: null,
  ...overrides,
});

describe("deriveAssignmentHours", () => {
  it("returns an adjustment override normalised to 2 dp", () => {
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T16:00:00.000Z",
        breakMinutes: 30,
        adjustedHours: "6.5",
      }),
    ).toBe("6.50");
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T16:00:00.000Z",
        breakMinutes: 0,
        adjustedHours: "8",
      }),
    ).toBe("8.00");
  });

  it("deducts the unpaid break from the shift duration", () => {
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T16:00:00.000Z",
        breakMinutes: 30,
        adjustedHours: null,
      }),
    ).toBe("7.50");
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T09:00:00.000Z",
        endsAt: "2026-07-01T17:30:00.000Z",
        breakMinutes: 45,
        adjustedHours: null,
      }),
    ).toBe("7.75");
  });

  it("floors a zero or negative net duration at zero", () => {
    const zero = deriveAssignmentHours({
      startsAt: "2026-07-01T08:00:00.000Z",
      endsAt: "2026-07-01T08:00:00.000Z",
      breakMinutes: 0,
      adjustedHours: null,
    });
    expect(zero).toBe("0.00");
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T16:00:00.000Z",
        endsAt: "2026-07-01T08:00:00.000Z",
        breakMinutes: 0,
        adjustedHours: null,
      }),
    ).toBe("0.00");
    // A break longer than the shift also floors at zero.
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T08:30:00.000Z",
        breakMinutes: 60,
        adjustedHours: null,
      }),
    ).toBe("0.00");
  });

  it("rounds a sub-hour duration HALF_UP at 2 dp", () => {
    // 18 s = 0.005 h: exactly half a hundredth, which rounds away from zero.
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-01T00:00:18.000Z",
        breakMinutes: 0,
        adjustedHours: null,
      }),
    ).toBe("0.01");
    // 1 h 1 min = 1.0166… h rounds up to 1.02.
    expect(
      deriveAssignmentHours({
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-01T01:01:00.000Z",
        breakMinutes: 0,
        adjustedHours: null,
      }),
    ).toBe("1.02");
  });

  it("rejects a malformed instant", () => {
    expect(() =>
      deriveAssignmentHours({
        startsAt: "not-a-date",
        endsAt: "2026-07-01T08:00:00.000Z",
        breakMinutes: 0,
        adjustedHours: null,
      }),
    ).toThrow(DomainError);
  });
});

describe("sumWorkedHoursByEmployee", () => {
  it("returns an empty array for no rows", () => {
    expect(sumWorkedHoursByEmployee([])).toEqual([]);
  });

  it("sums multiple assignments per employee, overriding where adjusted", () => {
    const rows: WorkedHoursRow[] = [
      row({ startsAt: "2026-07-01T08:00:00.000Z", endsAt: "2026-07-01T16:00:00.000Z" }),
      row({
        startsAt: "2026-07-02T08:00:00.000Z",
        endsAt: "2026-07-02T16:00:00.000Z",
        breakMinutes: 30,
      }),
      // An override replaces this assignment's own derivation.
      row({
        startsAt: "2026-07-03T08:00:00.000Z",
        endsAt: "2026-07-03T16:00:00.000Z",
        adjustedHours: "4.25",
      }),
    ];

    expect(sumWorkedHoursByEmployee(rows)).toEqual([
      { employeeId: "emp-1", employeeName: "Nora Nordmann", roleCode: "barista", hours: "19.75" },
    ]);
  });

  it("keeps employees separate and orders by name then id", () => {
    const rows: WorkedHoursRow[] = [
      row({
        employeeId: "emp-2",
        employeeName: "Zoe",
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T12:00:00.000Z",
      }),
      row({
        employeeId: "emp-3",
        employeeName: "Ana",
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T12:00:00.000Z",
      }),
      row({
        employeeId: "emp-1",
        employeeName: "Ana",
        startsAt: "2026-07-01T08:00:00.000Z",
        endsAt: "2026-07-01T13:00:00.000Z",
      }),
    ];

    expect(sumWorkedHoursByEmployee(rows)).toEqual([
      { employeeId: "emp-1", employeeName: "Ana", roleCode: "barista", hours: "5.00" },
      { employeeId: "emp-3", employeeName: "Ana", roleCode: "barista", hours: "4.00" },
      { employeeId: "emp-2", employeeName: "Zoe", roleCode: "barista", hours: "4.00" },
    ]);
  });
});
