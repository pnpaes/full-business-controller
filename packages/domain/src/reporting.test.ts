import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  SALES_REPORT_GRAINS,
  contributionBeforeLabour,
  contributionMarginPctOrNull,
  isSalesReportGrain,
  netSalesFromLine,
  periodBucket,
} from "./reporting";

describe("SALES_REPORT_GRAINS", () => {
  it("is the three reporting grains", () => {
    expect(SALES_REPORT_GRAINS).toEqual(["day", "week", "month"]);
  });

  it("recognises only its members", () => {
    expect(isSalesReportGrain("week")).toBe(true);
    expect(isSalesReportGrain("quarter")).toBe(false);
    expect(isSalesReportGrain("")).toBe(false);
  });
});

describe("periodBucket", () => {
  it("buckets a day in UTC, ignoring any offset", () => {
    expect(periodBucket("day", "2026-09-22T10:30:00Z")).toBe("2026-09-22");
    // 23:30+02:00 is 21:30Z the same UTC day.
    expect(periodBucket("day", "2026-09-22T23:30:00+02:00")).toBe("2026-09-22");
    // 00:30+02:00 is the previous UTC day.
    expect(periodBucket("day", "2026-09-22T00:30:00+02:00")).toBe("2026-09-21");
  });

  it("buckets a month in UTC", () => {
    expect(periodBucket("month", "2026-09-01T00:00:00Z")).toBe("2026-09");
    expect(periodBucket("month", "2026-09-30T23:59:59Z")).toBe("2026-09");
  });

  it("buckets an ISO week Monday–Sunday (DEC-032)", () => {
    // 2026-09-21 is a Monday; the week runs to Sunday 2026-09-27.
    expect(periodBucket("week", "2026-09-21T00:00:00Z")).toBe("2026-W39");
    expect(periodBucket("week", "2026-09-27T23:59:59Z")).toBe("2026-W39");
    // The next Monday starts a new week.
    expect(periodBucket("week", "2026-09-28T00:00:00Z")).toBe("2026-W40");
    // The Sunday belongs to the week that began the preceding Monday.
    expect(periodBucket("week", "2026-09-20T12:00:00Z")).toBe("2026-W38");
  });

  it("uses the ISO week-numbering year at a year boundary", () => {
    // 2021-01-01 is a Friday: ISO week 2020-W53, not 2021-W01.
    expect(periodBucket("week", "2021-01-01T00:00:00Z")).toBe("2020-W53");
    // 2019-12-30 is the Monday of ISO week 2020-W01.
    expect(periodBucket("week", "2019-12-30T00:00:00Z")).toBe("2020-W01");
    // 2020-12-31 is a Thursday: the last ISO week of 2020.
    expect(periodBucket("week", "2020-12-31T00:00:00Z")).toBe("2020-W53");
  });

  it("rejects an unknown grain and a malformed instant", () => {
    expect(() => periodBucket("quarter" as never, "2026-09-22T00:00:00Z")).toThrow(DomainError);
    expect(() => periodBucket("day", "not-an-instant")).toThrow(DomainError);
  });
});

describe("netSalesFromLine", () => {
  it("prefers the source-reported net amount verbatim", () => {
    expect(
      netSalesFromLine({
        grossAmount: "125.0000",
        taxAmount: "25.0000",
        discountAmount: "5.0000",
        refundAmount: "0.0000",
        netAmount: "100.0000",
      }),
    ).toBe("100.0000");
  });

  it("normalises a reported net amount to the money scale", () => {
    expect(
      netSalesFromLine({
        grossAmount: null,
        taxAmount: null,
        discountAmount: null,
        refundAmount: null,
        netAmount: "100",
      }),
    ).toBe("100.0000");
  });

  it("derives gross − tax − discount − refund when net is absent", () => {
    expect(
      netSalesFromLine({
        grossAmount: "125.0000",
        taxAmount: "25.0000",
        discountAmount: "5.0000",
        refundAmount: "2.5000",
        netAmount: null,
      }),
    ).toBe("92.5000");
  });

  it("treats a blank net amount as absent", () => {
    expect(
      netSalesFromLine({
        grossAmount: "10.0000",
        taxAmount: "1.0000",
        discountAmount: null,
        refundAmount: null,
        netAmount: "  ",
      }),
    ).toBe("9.0000");
  });

  it("treats missing components as zero", () => {
    expect(
      netSalesFromLine({
        grossAmount: "10.0000",
        taxAmount: null,
        discountAmount: null,
        refundAmount: null,
        netAmount: null,
      }),
    ).toBe("10.0000");
  });

  it("rejects a malformed amount", () => {
    expect(() =>
      netSalesFromLine({
        grossAmount: "1.2.3",
        taxAmount: null,
        discountAmount: null,
        refundAmount: null,
        netAmount: null,
      }),
    ).toThrow(DomainError);
  });
});

describe("contributionBeforeLabour", () => {
  it("is net sales minus ingredient cost", () => {
    expect(contributionBeforeLabour("100.0000", "32.5000")).toBe("67.5000");
  });

  it("may be negative when a period sells below ingredient cost", () => {
    expect(contributionBeforeLabour("10.0000", "12.0000")).toBe("-2.0000");
  });

  it("rejects a malformed input", () => {
    expect(() => contributionBeforeLabour("nope", "1.0000")).toThrow(DomainError);
  });
});

describe("contributionMarginPctOrNull", () => {
  it("computes the percentage at 6 dp when net sales are positive", () => {
    expect(contributionMarginPctOrNull("100.0000", "25.0000")).toBe("25.000000");
  });

  it("is null when net sales are zero or negative (DEC-063)", () => {
    expect(contributionMarginPctOrNull("0.0000", "0.0000")).toBeNull();
    expect(contributionMarginPctOrNull("-5.0000", "1.0000")).toBeNull();
  });

  it("rejects a malformed input", () => {
    expect(() => contributionMarginPctOrNull("100.0000", "x")).toThrow(DomainError);
  });
});
