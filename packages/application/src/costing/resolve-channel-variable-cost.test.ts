import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { resolveChannelVariableCost } from "./resolve-channel-variable-cost";
import type { ChannelFeeRuleRecord } from "./types";

const ORG = "org-1";
const CHANNEL = "chan-1";
const AS_OF = new Date("2026-06-01T00:00:00Z");

function rule(overrides: Partial<ChannelFeeRuleRecord> = {}): ChannelFeeRuleRecord {
  return {
    id: "fee-1",
    organizationId: ORG,
    channelId: CHANNEL,
    feeKind: "commission_pct",
    percentageRate: "0.100000",
    fixedAmount: null,
    feeBasis: "net_price",
    taxRuleId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  };
}

function store(rules: readonly ChannelFeeRuleRecord[]) {
  return {
    listEffectiveChannelFeeRules: () => Promise.resolve(rules),
  };
}

describe("resolveChannelVariableCost", () => {
  it("returns undefined when no fee rule is effective", async () => {
    const result = await resolveChannelVariableCost(store([]), {
      organizationId: ORG,
      channelId: CHANNEL,
      asOf: AS_OF,
      grossPrice: "42.3900",
      netPrice: "33.9130",
    });
    expect(result).toBeUndefined();
  });

  it("values a percentage rule against the configured basis", async () => {
    const result = await resolveChannelVariableCost(
      store([
        rule({ feeBasis: "net_price", percentageRate: "0.100000" }),
        rule({ id: "fee-2", feeBasis: "gross_price", percentageRate: "0.050000" }),
      ]),
      {
        organizationId: ORG,
        channelId: CHANNEL,
        asOf: AS_OF,
        grossPrice: "42.3900",
        netPrice: "33.9130",
      },
    );
    // 0.1 × 33.9130 = 3.3913; 0.05 × 42.3900 = 2.1195; sum = 5.5108.
    expect(result?.perUnitCost).toBe("5.5108");
    expect(result?.ruleIds).toEqual(["fee-1", "fee-2"]);
  });

  it("divides a fixed per-order fee across the order size", async () => {
    const result = await resolveChannelVariableCost(
      store([
        rule({
          feeKind: "fixed_per_order",
          percentageRate: null,
          fixedAmount: "9.0000",
          feeBasis: "per_order",
        }),
      ]),
      {
        organizationId: ORG,
        channelId: CHANNEL,
        asOf: AS_OF,
        grossPrice: "42.3900",
        netPrice: "33.9130",
        unitsPerOrder: "3",
      },
    );
    // 9.0000 / 3 = 3.0000.
    expect(result?.perUnitCost).toBe("3.0000");
  });

  it("rejects a per_order basis on a percentage kind", async () => {
    await expect(
      resolveChannelVariableCost(store([rule({ feeBasis: "per_order" })]), {
        organizationId: ORG,
        channelId: CHANNEL,
        asOf: AS_OF,
        grossPrice: "42.3900",
        netPrice: "33.9130",
      }),
    ).rejects.toThrow(/feeBasis "per_order" is invalid for percentage feeKind "commission_pct"/);
  });

  it("rejects a non-per_order basis on a fixed kind", async () => {
    await expect(
      resolveChannelVariableCost(
        store([
          rule({
            feeKind: "delivery_subsidy",
            percentageRate: null,
            fixedAmount: "5.0000",
            feeBasis: "net_price",
          }),
        ]),
        {
          organizationId: ORG,
          channelId: CHANNEL,
          asOf: AS_OF,
          grossPrice: "42.3900",
          netPrice: "33.9130",
        },
      ),
    ).rejects.toThrow(/requires feeBasis "per_order"/);
  });

  it("fails closed on an unknown fee kind", async () => {
    await expect(
      resolveChannelVariableCost(store([rule({ feeKind: "mystery" })]), {
        organizationId: ORG,
        channelId: CHANNEL,
        asOf: AS_OF,
        grossPrice: "42.3900",
        netPrice: "33.9130",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("validates unitsPerOrder only when a fixed kind needs it", async () => {
    // A percentage-only channel never uses unitsPerOrder, so "0" resolves fine.
    const percentage = await resolveChannelVariableCost(store([rule()]), {
      organizationId: ORG,
      channelId: CHANNEL,
      asOf: AS_OF,
      grossPrice: "42.3900",
      netPrice: "33.9130",
      unitsPerOrder: "0",
    });
    expect(percentage?.perUnitCost).toBe("3.3913");

    await expect(
      resolveChannelVariableCost(
        store([
          rule({
            feeKind: "fixed_per_order",
            percentageRate: null,
            fixedAmount: "9.0000",
            feeBasis: "per_order",
          }),
        ]),
        {
          organizationId: ORG,
          channelId: CHANNEL,
          asOf: AS_OF,
          grossPrice: "42.3900",
          netPrice: "33.9130",
          unitsPerOrder: "0",
        },
      ),
    ).rejects.toThrow(/unitsPerOrder must be a positive decimal with at most 6 decimal places/);
  });
});
