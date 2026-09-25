import { describe, expect, it } from "vitest";

import {
  formatAccuracy,
  formatCompletedPeriods,
  formatTrackingError,
  grainLabel,
  trackingStatusLabel,
  trackingStatusTone,
} from "./forecast-tracking-labels";

describe("forecast-tracking-labels", () => {
  it("labels every forecast grain and passes an unknown one through", () => {
    expect(grainLabel("day_location")).toBe("Daily, by location");
    expect(grainLabel("day_location_product")).toBe("Daily, by location & product");
    expect(grainLabel("quarter")).toBe("quarter");
  });

  it("labels each honest tracking state with a distinct tone", () => {
    expect(trackingStatusLabel("ok")).toBe("Tracking");
    expect(trackingStatusLabel("insufficient_history")).toBe("Not enough completed periods");
    expect(trackingStatusLabel("no_snapshot")).toBe("No snapshot recorded");

    expect(trackingStatusTone("ok")).toBe("success");
    expect(trackingStatusTone("insufficient_history")).toBe("warning");
    expect(trackingStatusTone("no_snapshot")).toBe("neutral");
  });

  it("formats a MAPE fraction as a 1 dp percentage and withholds a null", () => {
    expect(formatAccuracy("0.100000")).toBe("10.0%");
    expect(formatAccuracy("0.123456")).toBe("12.3%");
    expect(formatAccuracy(null)).toBe("n/a");
  });

  it("formats a period percentage error and withholds a null", () => {
    expect(formatTrackingError("0.055000")).toBe("5.5%");
    expect(formatTrackingError(null)).toBe("n/a");
  });

  it("pluralises the completed-period count", () => {
    expect(formatCompletedPeriods(1)).toBe("1 completed period");
    expect(formatCompletedPeriods(4)).toBe("4 completed periods");
  });
});
