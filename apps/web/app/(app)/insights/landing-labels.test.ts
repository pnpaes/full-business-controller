import { describe, expect, it } from "vitest";

import { topByContribution } from "./landing-labels";

/** Minimal group stub: only the fields `topByContribution` reads. */
function group(
  label: string,
  contributionBeforeLabour: string,
): Parameters<typeof topByContribution>[0][number] {
  return {
    label,
    contributionBeforeLabour,
  } as Parameters<typeof topByContribution>[0][number];
}

describe("topByContribution", () => {
  it("ranks by contribution descending, exactly on the decimal string", () => {
    const groups = [group("B", "100.0000"), group("A", "250.5000"), group("C", "99.9999")];
    expect(topByContribution(groups, 2).map((g) => g.label)).toEqual(["A", "B"]);
  });

  it("keeps the report's original order on ties", () => {
    const groups = [group("First", "10.0000"), group("Second", "10.0000")];
    expect(topByContribution(groups, 2).map((g) => g.label)).toEqual(["First", "Second"]);
  });

  it("handles negative contributions and a larger limit than the input", () => {
    const groups = [group("Loss", "-5.0000"), group("Gain", "3.0000")];
    expect(topByContribution(groups, 10).map((g) => g.label)).toEqual(["Gain", "Loss"]);
  });
});
