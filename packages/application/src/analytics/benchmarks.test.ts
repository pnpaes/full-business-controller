import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeReportingStore, type SalesGroupRow } from "../reporting";

import { BENCHMARK_BASIS_NOTE, computeBenchmarks } from "./benchmarks";

const ORG = "org-1";
const PERIOD = { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.000Z" };

function locationGroup(id: string | null, netSales: string): SalesGroupRow {
  return {
    key: id ?? "unmapped",
    label: id === null ? "Unmapped" : `Location ${id}`,
    locationId: id,
    channelId: null,
    category: null,
    productVariantId: null,
    productKind: null,
    optionKinds: [],
    periodBucket: "2026-09",
    transactions: 1,
    units: "1.000000",
    grossSales: netSales,
    netSales,
    taxAmount: "0.0000",
    discountAmount: "0.0000",
    refundAmount: "0.0000",
    ingredientCost: "0.0000",
  };
}

function storeWith(...rows: readonly SalesGroupRow[]): FakeReportingStore {
  const store = new FakeReportingStore();
  for (const row of rows) {
    store.seedGroup(ORG, row);
  }
  return store;
}

describe("computeBenchmarks", () => {
  it("compares each entity with the organization aggregate and the peer median", async () => {
    const store = storeWith(
      locationGroup("a", "300.0000"),
      locationGroup("b", "200.0000"),
      locationGroup("c", "100.0000"),
    );

    const report = await computeBenchmarks(store, {
      organizationId: ORG,
      dimension: "location",
      metric: "revenue",
      period: PERIOD,
    });

    expect(report.basis).toBe("internal");
    expect(report.basisNote).toBe(BENCHMARK_BASIS_NOTE);
    expect(report.organizationAggregate).toBe("600.0000");
    expect(report.peerMedian).toBe("200.0000");
    const a = report.entities.find((entity) => entity.entityId === "a")!;
    const b = report.entities.find((entity) => entity.entityId === "b")!;
    const c = report.entities.find((entity) => entity.entityId === "c")!;
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    expect(c.rank).toBe(3);
    expect(a.ratioToOrganization).toBe("0.500000");
    expect(a.ratioToPeerMedian).toBe("1.500000");
    expect(a.meetsPeerMedian).toBe(true);
    expect(c.meetsPeerMedian).toBe(false);
  });

  it("uses the mean of the two middle values for an even count", async () => {
    const store = storeWith(
      locationGroup("a", "400.0000"),
      locationGroup("b", "300.0000"),
      locationGroup("c", "200.0000"),
      locationGroup("d", "100.0000"),
    );

    const report = await computeBenchmarks(store, {
      organizationId: ORG,
      dimension: "location",
      metric: "revenue",
      period: PERIOD,
    });

    expect(report.peerMedian).toBe("250.0000");
  });

  it("excludes the unmapped bucket from the median and the rank", async () => {
    const store = storeWith(
      locationGroup("a", "300.0000"),
      locationGroup("b", "200.0000"),
      locationGroup("c", "100.0000"),
      locationGroup(null, "1000.0000"),
    );

    const report = await computeBenchmarks(store, {
      organizationId: ORG,
      dimension: "location",
      metric: "revenue",
      period: PERIOD,
    });

    expect(report.peerMedian).toBe("200.0000");
    const unmapped = report.entities.find((entity) => entity.isUnmapped)!;
    expect(unmapped.rank).toBeNull();
    expect(unmapped.meetsPeerMedian).toBeNull();
  });

  it("rejects a metric the benchmark does not support and an unknown dimension", async () => {
    const store = storeWith(locationGroup("a", "300.0000"));
    await expect(
      computeBenchmarks(store, {
        organizationId: ORG,
        dimension: "location",
        metric: "production_yield" as never,
        period: PERIOD,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      computeBenchmarks(store, {
        organizationId: ORG,
        dimension: "supplier" as never,
        metric: "revenue",
        period: PERIOD,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
