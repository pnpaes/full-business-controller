import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { closeAdjustmentPeriod } from "./close-adjustment-period";
import { findAdjustmentPeriod } from "./find-adjustment-period";
import { DEFAULT_ADJUSTMENT_PERIOD_LIMIT, listAdjustmentPeriods } from "./list-adjustment-periods";
import { openAdjustmentPeriod } from "./open-adjustment-period";
import {
  FakeAdjustmentPeriodStore,
  seedAdjustmentPeriodFixture,
  type AdjustmentPeriodFixture,
} from "./test-support";
import { ADJUSTMENT_PERIOD_STATUSES } from "./types";

function setup(): { store: FakeAdjustmentPeriodStore; fixture: AdjustmentPeriodFixture } {
  return { store: new FakeAdjustmentPeriodStore(), fixture: seedAdjustmentPeriodFixture() };
}

function open(
  store: FakeAdjustmentPeriodStore,
  fixture: AdjustmentPeriodFixture,
  overrides: Partial<Parameters<typeof openAdjustmentPeriod>[1]> = {},
) {
  return openAdjustmentPeriod(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    openedFrom: fixture.openedFrom,
    openedTo: fixture.openedTo,
    reason: fixture.reason,
    ...overrides,
  });
}

describe("adjustment-period vocabularies", () => {
  it("mirrors the persistence status enum", () => {
    expect(ADJUSTMENT_PERIOD_STATUSES).toEqual(["open", "closed"]);
  });
});

describe("openAdjustmentPeriod", () => {
  it("opens a window with single-stage approval and its audit fact", async () => {
    const { store, fixture } = setup();

    const period = await open(store, fixture);

    expect(period).toMatchObject({
      organizationId: fixture.organizationId,
      openedFrom: fixture.openedFrom,
      openedTo: fixture.openedTo,
      reason: fixture.reason,
      status: "open",
      approvedBy: fixture.actorId,
      updatedAt: null,
    });
    expect(period.approvedAt).not.toBeNull();
    expect(store.periods.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "close.adjustment_period.opened");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "adjustment_period",
      entityId: period.id,
      after: expect.objectContaining({ status: "open", approved_by: fixture.actorId }),
    });
  });

  it("trims the reason", async () => {
    const { store, fixture } = setup();

    const period = await open(store, fixture, { reason: "  late corrections  " });

    expect(period.reason).toBe("late corrections");
  });

  it("allows a single-day window", async () => {
    const { store, fixture } = setup();

    const period = await open(store, fixture, {
      openedFrom: "2026-03-05",
      openedTo: "2026-03-05",
    });

    expect(period.openedFrom).toBe(period.openedTo);
  });

  it("refuses a second open period for the organization", async () => {
    const { store, fixture } = setup();
    await open(store, fixture);

    await expect(open(store, fixture)).rejects.toThrow(DomainError);
    expect(store.periods.size).toBe(1);
    expect(store.audits).toHaveLength(1);
  });

  it("treats a create race for a new open period as the winner's result (F2)", async () => {
    const { store, fixture } = setup();
    const seeded = await open(store, fixture);
    const auditsAfterSeed = store.audits.length;

    // Simulate the loser of a concurrent open: the existence read misses (the
    // winner's row was not visible yet), then the INSERT collides on the partial
    // unique. The first read is the pre-check; later reads see the winner.
    const racing = Object.create(store) as FakeAdjustmentPeriodStore;
    let firstRead = true;
    racing.findOpenAdjustmentPeriod = async (query) => {
      if (firstRead) {
        firstRead = false;
        return undefined;
      }
      return FakeAdjustmentPeriodStore.prototype.findOpenAdjustmentPeriod.call(store, query);
    };

    const result = await open(racing, fixture);

    expect(result.id).toBe(seeded.id);
    expect(store.audits).toHaveLength(auditsAfterSeed);
  });

  it.each([
    ["inverted window", { openedFrom: "2026-03-05", openedTo: "2026-03-01" }],
    ["malformed openedFrom", { openedFrom: "2026-13-01" }],
    ["impossible openedTo", { openedTo: "2026-02-31" }],
    ["empty reason", { reason: "   " }],
  ])("rejects %s before touching the store", async (_label, overrides) => {
    const { store, fixture } = setup();

    await expect(open(store, fixture, overrides)).rejects.toThrow(DomainError);
    expect(store.periods.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("closeAdjustmentPeriod", () => {
  it("closes an open period and records the audit", async () => {
    const { store, fixture } = setup();
    const opened = await open(store, fixture);

    const closed = await closeAdjustmentPeriod(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      adjustmentPeriodId: opened.id,
    });

    expect(closed).toMatchObject({ status: "closed" });
    expect(closed.updatedAt).not.toBeNull();
    expect(
      store.audits.find((row) => row.action === "close.adjustment_period.closed"),
    ).toMatchObject({
      entityId: opened.id,
      before: { status: "open" },
      after: { status: "closed" },
    });
  });

  it("is idempotent when already closed (no new audit fact)", async () => {
    const { store, fixture } = setup();
    const opened = await open(store, fixture);
    const closed = await closeAdjustmentPeriod(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      adjustmentPeriodId: opened.id,
    });

    const again = await closeAdjustmentPeriod(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      adjustmentPeriodId: opened.id,
    });

    expect(again).toEqual(closed);
    expect(
      store.audits.filter((row) => row.action === "close.adjustment_period.closed"),
    ).toHaveLength(1);
  });

  it("throws NotFoundError for a missing or cross-organization id", async () => {
    const { store, fixture } = setup();
    const opened = await open(store, fixture);

    await expect(
      closeAdjustmentPeriod(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        adjustmentPeriodId: opened.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects a blank id before touching the store", async () => {
    const { store, fixture } = setup();

    await expect(
      closeAdjustmentPeriod(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        adjustmentPeriodId: "   ",
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("findAdjustmentPeriod / listAdjustmentPeriods", () => {
  it("scopes reads to the organization", async () => {
    const { store, fixture } = setup();
    const opened = await open(store, fixture);

    expect(
      await findAdjustmentPeriod(store, {
        organizationId: fixture.organizationId,
        adjustmentPeriodId: opened.id,
      }),
    ).toMatchObject({ id: opened.id });
    expect(
      await findAdjustmentPeriod(store, {
        organizationId: fixture.otherOrganizationId,
        adjustmentPeriodId: opened.id,
      }),
    ).toBeUndefined();
    expect(
      await listAdjustmentPeriods(store, { organizationId: fixture.otherOrganizationId }),
    ).toEqual([]);
  });

  it("lists newest window first with filters and a bounded page", async () => {
    const { store, fixture } = setup();
    const first = await open(store, fixture, {
      openedFrom: "2026-03-01",
      openedTo: "2026-03-05",
    });
    await closeAdjustmentPeriod(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      adjustmentPeriodId: first.id,
    });
    await open(store, fixture, { openedFrom: "2026-04-01", openedTo: "2026-04-02" });

    const rows = await listAdjustmentPeriods(store, {
      organizationId: fixture.organizationId,
      limit: DEFAULT_ADJUSTMENT_PERIOD_LIMIT,
    });
    expect(rows.map((row) => row.openedFrom)).toEqual(["2026-04-01", "2026-03-01"]);

    const filtered = await listAdjustmentPeriods(store, {
      organizationId: fixture.organizationId,
      status: "closed",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(first.id);

    const windowed = await listAdjustmentPeriods(store, {
      organizationId: fixture.organizationId,
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(windowed.map((row) => row.id)).toEqual([first.id]);
  });

  it("rejects a bogus status filter", async () => {
    const { store, fixture } = setup();

    await expect(
      listAdjustmentPeriods(store, { organizationId: fixture.organizationId, status: "bogus" }),
    ).rejects.toThrow(DomainError);
  });
});

describe("transaction rollback", () => {
  it("restores the maps and audits when a transaction callback throws", async () => {
    const { store, fixture } = setup();
    await open(store, fixture);
    const before = new Map(store.periods);
    const auditsBefore = store.audits.length;

    await expect(
      store.withTransaction(async (tx) => {
        await tx.createAdjustmentPeriod({
          organizationId: fixture.organizationId,
          openedFrom: "2026-04-01",
          openedTo: "2026-04-02",
          reason: "other",
          status: "closed",
          approvedBy: fixture.actorId,
          approvedAt: new Date().toISOString(),
          createdBy: fixture.actorId,
        });
        await tx.writeAudit({
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          action: "close.adjustment_period.opened",
          entityType: "adjustment_period",
          entityId: null,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.periods).toEqual(before);
    expect(store.audits).toHaveLength(auditsBefore);
  });
});
