import { describe, expect, it } from "vitest";

import { formatJobInstant, isJobStatus, jobStatusView } from "./jobs-labels";

describe("jobStatusView", () => {
  it("maps the five job statuses to a tone and label", () => {
    expect(jobStatusView("dead_lettered")).toEqual({ tone: "danger", label: "Dead-lettered" });
    expect(jobStatusView("succeeded")).toEqual({ tone: "success", label: "Succeeded" });
    expect(jobStatusView("pending")).toEqual({ tone: "info", label: "Pending" });
  });

  it("passes an unknown status through rather than inventing a label", () => {
    expect(jobStatusView("something_new")).toEqual({ tone: "info", label: "something_new" });
  });
});

describe("isJobStatus", () => {
  it("accepts only the known statuses", () => {
    expect(isJobStatus("running")).toBe(true);
    expect(isJobStatus("not_a_status")).toBe(false);
  });
});

describe("formatJobInstant", () => {
  it("renders null/undefined as an em dash", () => {
    expect(formatJobInstant(null)).toBe("—");
    expect(formatJobInstant(undefined)).toBe("—");
  });

  it("renders an ISO string to minute precision in UTC", () => {
    expect(formatJobInstant("2026-09-27T08:15:42.123Z")).toBe("2026-09-27 08:15 UTC");
  });

  it("renders a Date the same way", () => {
    expect(formatJobInstant(new Date("2026-09-27T08:15:42.123Z"))).toBe("2026-09-27 08:15 UTC");
  });
});
