import { describe, expect, it } from "vitest";

import { fractionToPercentDisplay, taxScopeLabel } from "./tax-rule-labels";

describe("fractionToPercentDisplay", () => {
  it("converts exact fraction strings without a spurious leading zero (m5)", () => {
    expect(fractionToPercentDisplay("0.150000")).toBe("15");
    expect(fractionToPercentDisplay("0.250000")).toBe("25");
    expect(fractionToPercentDisplay("0.010000")).toBe("1");
    expect(fractionToPercentDisplay("0.123456")).toBe("12.3456");
    expect(fractionToPercentDisplay("1.000000")).toBe("100");
  });

  it("renders a zero fraction and a negative fraction", () => {
    expect(fractionToPercentDisplay("0.000000")).toBe("0");
    expect(fractionToPercentDisplay("-0.150000")).toBe("-15");
  });
});

describe("taxScopeLabel", () => {
  const channels = new Map([["chan-1", "IN · Eat in"]]);
  const locations = new Map([["loc-1", "Downtown"]]);

  it("resolves a location-scoped rule's location, whose channelId is null (M4)", () => {
    expect(
      taxScopeLabel(
        { scopeType: "location", locationId: "loc-1", channelId: null },
        channels,
        locations,
      ),
    ).toBe("location · Downtown");
  });

  it("resolves a channel-scoped rule's channel", () => {
    expect(
      taxScopeLabel(
        { scopeType: "channel", locationId: null, channelId: "chan-1" },
        channels,
        locations,
      ),
    ).toBe("channel · IN · Eat in");
  });

  it("states unknown when the referenced row is missing", () => {
    expect(
      taxScopeLabel(
        { scopeType: "location", locationId: "loc-9", channelId: null },
        channels,
        locations,
      ),
    ).toBe("location · unknown");
  });

  it("labels the two org-wide scopes", () => {
    expect(
      taxScopeLabel(
        { scopeType: "organization", locationId: null, channelId: null },
        channels,
        locations,
      ),
    ).toBe("organization");
    expect(
      taxScopeLabel(
        { scopeType: "company_wide", locationId: null, channelId: null },
        channels,
        locations,
      ),
    ).toBe("company wide");
  });

  it("reads an unknown scope as itself, never as company-wide", () => {
    expect(
      taxScopeLabel(
        { scopeType: "storage", locationId: null, channelId: null },
        channels,
        locations,
      ),
    ).toBe("storage");
  });
});
