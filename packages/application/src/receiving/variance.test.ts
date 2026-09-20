import { describe, expect, it } from "vitest";

import { assessReceiptVariances } from "./variance";

const line = (
  overrides: Partial<{
    lineIndex: number;
    receivedPackQty: string;
    acceptedPackQty: string;
    previousLandedBaseUnitCost: string | null;
    landedBaseUnitCost: string;
  }> = {},
) => ({
  lineIndex: 0,
  receivedPackQty: "2",
  acceptedPackQty: "2",
  previousLandedBaseUnitCost: null as string | null,
  landedBaseUnitCost: "0.0500",
  ...overrides,
});

describe("assessReceiptVariances", () => {
  it("produces nothing for a clean first purchase", () => {
    expect(assessReceiptVariances([line()])).toEqual([]);
  });

  it("warns when fewer packs are accepted than received", () => {
    const warnings = assessReceiptVariances([
      line({ receivedPackQty: "4", acceptedPackQty: "3.5" }),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ lineIndex: 0, kind: "quantity", severity: "warning" });
    expect(warnings[0]!.message).toBe("Line 1: 0.5 of 4 packs not accepted (12.50%).");
  });

  it("warns when the landed unit cost moves at or above the threshold", () => {
    const up = assessReceiptVariances([
      line({ previousLandedBaseUnitCost: "0.0500", landedBaseUnitCost: "0.0600" }),
    ]);
    const down = assessReceiptVariances([
      line({ previousLandedBaseUnitCost: "0.1000", landedBaseUnitCost: "0.0900" }),
    ]);

    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ kind: "price", severity: "warning" });
    expect(up[0]!.message).toBe("Line 1: landed unit cost 0.06 changed 20.00% from 0.05.");
    expect(down).toHaveLength(1);
    expect(down[0]!.message).toBe("Line 1: landed unit cost 0.09 changed 10.00% from 0.1.");
  });

  it("stays quiet below the price threshold", () => {
    const warnings = assessReceiptVariances([
      line({ previousLandedBaseUnitCost: "0.0500", landedBaseUnitCost: "0.0520" }),
    ]);

    expect(warnings).toEqual([]);
  });

  it("reports both variances for one line and keeps line order", () => {
    const warnings = assessReceiptVariances([
      line({ lineIndex: 0, receivedPackQty: "3", acceptedPackQty: "2" }),
      line({
        lineIndex: 1,
        receivedPackQty: "1",
        acceptedPackQty: "1",
        previousLandedBaseUnitCost: "0.0500",
        landedBaseUnitCost: "0.0600",
      }),
    ]);

    expect(warnings.map((warning) => warning.lineIndex)).toEqual([0, 1]);
    expect(warnings.map((warning) => warning.kind)).toEqual(["quantity", "price"]);
  });
});
