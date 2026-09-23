import { describe, expect, it } from "vitest";

import { registerChannelFeeRule } from "./register-channel-fee-rule";
import { FakeCostingStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";
const CHANNEL = "chan-1";
const FROM = "2026-01-01T00:00:00.000Z";

function seedChannel(store: FakeCostingStore, id: string, organizationId = ORG): string {
  store.channels.set(id, { id, organizationId });
  return id;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    channelId: CHANNEL,
    feeKind: "commission_pct",
    percentageRate: "0.100000",
    feeBasis: "net_price",
    effectiveFrom: FROM,
    ...overrides,
  };
}

describe("registerChannelFeeRule", () => {
  it("registers a percentage rule and audits it", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);

    const result = await registerChannelFeeRule(store, baseInput());

    expect(store.channelFeeRules).toEqual([
      expect.objectContaining({
        id: result.channelFeeRuleId,
        channelId: CHANNEL,
        feeKind: "commission_pct",
        percentageRate: "0.100000",
        fixedAmount: null,
        feeBasis: "net_price",
      }),
    ]);
    expect(store.audits.at(-1)).toMatchObject({
      action: "costing.channel_fee_rule.registered",
      entityType: "channel_fee_rule",
    });
  });

  it("registers a fixed per-order rule", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);

    await registerChannelFeeRule(
      store,
      baseInput({
        feeKind: "fixed_per_order",
        percentageRate: undefined,
        fixedAmount: "9.0000",
        feeBasis: "per_order",
      }),
    );

    expect(store.channelFeeRules.at(-1)).toMatchObject({
      feeKind: "fixed_per_order",
      fixedAmount: "9.0000",
      percentageRate: null,
    });
  });

  it("rejects unknown vocabulary and inconsistent amounts", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);

    await expect(registerChannelFeeRule(store, baseInput({ feeKind: "mystery" }))).rejects.toThrow(
      /feeKind must be one of/,
    );
    await expect(
      registerChannelFeeRule(store, baseInput({ feeBasis: "per_item" })),
    ).rejects.toThrow(/feeBasis must be one of/);
    await expect(
      registerChannelFeeRule(store, baseInput({ percentageRate: undefined })),
    ).rejects.toThrow(/requires a percentageRate/);
    await expect(
      registerChannelFeeRule(store, baseInput({ fixedAmount: "1.0000" })),
    ).rejects.toThrow(/must not carry a fixedAmount/);
    await expect(
      registerChannelFeeRule(
        store,
        baseInput({
          feeKind: "delivery_subsidy",
          percentageRate: undefined,
          fixedAmount: undefined,
        }),
      ),
    ).rejects.toThrow(/requires a fixedAmount/);
    await expect(
      registerChannelFeeRule(
        store,
        baseInput({ feeKind: "delivery_subsidy", percentageRate: "0.1", fixedAmount: "1.0000" }),
      ),
    ).rejects.toThrow(/must not carry a percentageRate/);
  });

  it("rejects a negative amount and a non-advancing window", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);

    await expect(
      registerChannelFeeRule(store, baseInput({ percentageRate: "-0.100000" })),
    ).rejects.toThrow(/percentageRate must not be negative/);
    await expect(
      registerChannelFeeRule(
        store,
        baseInput({
          feeKind: "fixed_per_order",
          percentageRate: undefined,
          fixedAmount: "-1.0000",
          feeBasis: "per_order",
        }),
      ),
    ).rejects.toThrow(/fixedAmount must not be negative/);
    await expect(
      registerChannelFeeRule(
        store,
        baseInput({ effectiveFrom: FROM, effectiveTo: "2025-01-01T00:00:00.000Z" }),
      ),
    ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
  });

  it("rejects a channel from another organization", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL, "org-2");

    await expect(registerChannelFeeRule(store, baseInput())).rejects.toThrow(
      /channel not found in organization/,
    );
  });

  it("rejects an overlapping window and accepts a non-overlapping successor", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);
    const first = await registerChannelFeeRule(
      store,
      baseInput({
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-06-01T00:00:00.000Z",
      }),
    );

    await expect(
      registerChannelFeeRule(store, baseInput({ effectiveFrom: "2026-03-01T00:00:00.000Z" })),
    ).rejects.toThrow(/overlapping this effective window/);

    const second = await registerChannelFeeRule(
      store,
      baseInput({ effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    );
    expect(second.channelFeeRuleId).not.toBe(first.channelFeeRuleId);
  });

  it("scopes the overlap check to the same fee kind", async () => {
    const store = new FakeCostingStore();
    seedChannel(store, CHANNEL);
    await registerChannelFeeRule(
      store,
      baseInput({
        feeKind: "commission_pct",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-06-01T00:00:00.000Z",
      }),
    );

    // (a) a different fee kind may overlap the existing window.
    const fixed = await registerChannelFeeRule(
      store,
      baseInput({
        feeKind: "fixed_per_order",
        percentageRate: undefined,
        fixedAmount: "9.0000",
        feeBasis: "per_order",
        effectiveFrom: "2026-03-01T00:00:00.000Z",
      }),
    );
    expect(fixed.channelFeeRuleId).toBeDefined();

    // (b) the same fee kind may not overlap.
    await expect(
      registerChannelFeeRule(store, baseInput({ effectiveFrom: "2026-03-01T00:00:00.000Z" })),
    ).rejects.toThrow(/overlapping this effective window/);

    // (c) the same fee kind accepts a non-overlapping successor.
    const successor = await registerChannelFeeRule(
      store,
      baseInput({ effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    );
    expect(successor.channelFeeRuleId).toBeDefined();
  });
});
