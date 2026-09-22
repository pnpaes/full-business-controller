import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { beginPeriodClose } from "./begin-period-close";
import { findPeriodClose } from "./find-period-close";
import { isPeriodLocked } from "./is-period-locked";
import { DEFAULT_PERIOD_CLOSE_LIMIT, listPeriodCloses } from "./list-period-closes";
import { lockPeriodClose } from "./lock-period-close";
import { reopenPeriodClose } from "./reopen-period-close";
import {
  FakePeriodCloseStore,
  seedPeriodCloseFixture,
  type PeriodCloseFixture,
} from "./test-support";
import { PERIOD_CLOSE_SCOPE_TYPES, PERIOD_CLOSE_STATUSES } from "./types";

const CHECKLIST = [{ key: "cash_counted", label: "Count the till", done: true }];

function setup(): { store: FakePeriodCloseStore; fixture: PeriodCloseFixture } {
  return { store: new FakePeriodCloseStore(), fixture: seedPeriodCloseFixture() };
}

function beginLocation(
  store: FakePeriodCloseStore,
  fixture: PeriodCloseFixture,
  overrides: Partial<Parameters<typeof beginPeriodClose>[1]> = {},
) {
  return beginPeriodClose(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    scopeType: "location",
    scopeId: fixture.locationId,
    periodStart: fixture.day,
    checklist: CHECKLIST,
    ...overrides,
  });
}

describe("close vocabularies", () => {
  it("mirrors the persistence scope and status enums", () => {
    expect(PERIOD_CLOSE_SCOPE_TYPES).toEqual(["location", "company"]);
    expect(PERIOD_CLOSE_STATUSES).toEqual(["open", "closing", "locked", "reopened"]);
  });
});

describe("beginPeriodClose", () => {
  it("opens a location close for a single day with its audit fact", async () => {
    const { store, fixture } = setup();

    const close = await beginLocation(store, fixture);

    expect(close).toMatchObject({
      organizationId: fixture.organizationId,
      scopeType: "location",
      scopeId: fixture.locationId,
      periodStart: fixture.day,
      periodEnd: fixture.day,
      status: "closing",
      checklist: CHECKLIST,
      lockedBy: null,
      lockedAt: null,
      reopenedBy: null,
      reopenedAt: null,
      reopenReason: null,
      updatedAt: null,
    });
    expect((close.snapshot as { schemaVersion: number }).schemaVersion).toBe(1);
    expect(store.periodCloses.size).toBe(1);

    const audit = store.audits.find((row) => row.action === "close.period_close.started");
    expect(audit).toMatchObject({
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      entityType: "period_close",
      entityId: close.id,
      after: expect.objectContaining({ status: "closing" }),
    });
  });

  it("opens a company close for the whole calendar month", async () => {
    const { store, fixture } = setup();

    const close = await beginPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      scopeType: "company",
      scopeId: fixture.organizationId,
      periodStart: fixture.monthStart,
      checklist: [],
    });

    expect(close).toMatchObject({
      scopeType: "company",
      scopeId: fixture.organizationId,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      status: "closing",
    });
  });

  it("is an idempotent no-op while already closing (no new audit fact)", async () => {
    const { store, fixture } = setup();
    const first = await beginLocation(store, fixture);

    const second = await beginLocation(store, fixture, {
      checklist: [{ key: "other", label: "Other", done: false }],
    });

    expect(second).toEqual(first);
    expect(store.audits.filter((row) => row.action === "close.period_close.started")).toHaveLength(
      1,
    );
  });

  it("re-begins a reopened close, replacing the checklist and snapshot", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);
    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });
    await reopenPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: locked.id,
      reason: "correction",
    });

    const reBegun = await beginLocation(store, fixture, {
      checklist: [{ key: "recount", label: "Recount", done: true }],
    });

    expect(reBegun.status).toBe("closing");
    expect(reBegun.checklist).toEqual([{ key: "recount", label: "Recount", done: true }]);
    expect(store.audits.filter((row) => row.action === "close.period_close.started")).toHaveLength(
      2,
    );
  });

  it("refuses to begin a locked period", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);
    await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    await expect(beginLocation(store, fixture)).rejects.toThrow(DomainError);
  });

  it("rejects a company scope whose scopeId is not the organization id (F5)", async () => {
    const { store, fixture } = setup();

    await expect(
      beginPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        scopeType: "company",
        scopeId: fixture.locationId,
        periodStart: fixture.monthStart,
        checklist: [],
      }),
    ).rejects.toThrow(DomainError);
    expect(store.periodCloses.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it("treats a create race for a new scope as an idempotent no-op (F2)", async () => {
    const { store, fixture } = setup();
    const seeded = await beginLocation(store, fixture);
    const auditsAfterSeed = store.audits.length;

    // Simulate the loser of a concurrent create: the scope lock read misses (the
    // winner's row was not visible yet), then the INSERT collides on the unique.
    const racing = Object.create(store) as FakePeriodCloseStore;
    racing.lockPeriodCloseForScope = async () => undefined;

    const result = await beginPeriodClose(racing, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      scopeType: "location",
      scopeId: fixture.locationId,
      periodStart: fixture.day,
      checklist: [],
    });

    expect(result.id).toBe(seeded.id);
    expect(store.audits).toHaveLength(auditsAfterSeed);
  });

  it("rejects a duplicate scope+period create in the fake (mirrors the unique)", async () => {
    const { store, fixture } = setup();
    const seeded = await beginLocation(store, fixture);

    await expect(
      store.createPeriodClose({
        organizationId: fixture.organizationId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: fixture.day,
        periodEnd: fixture.day,
        status: "closing",
        checklist: [],
        snapshot: null,
        createdBy: fixture.actorId,
      }),
    ).rejects.toThrow(DomainError);
    expect(store.periodCloses.size).toBe(1);
    expect(seeded.id).toBeDefined();
  });

  it.each([
    ["company start not the first day", { scopeType: "company", periodStart: "2026-03-02" }],
    ["unknown scope", { scopeType: "organization", periodStart: "2026-03-01" }],
    ["malformed day", { scopeType: "location", periodStart: "2026-02-31" }],
    ["malformed checklist", { scopeType: "location", periodStart: "2026-03-05", checklist: {} }],
  ])("rejects %s before touching the store", async (_label, overrides) => {
    const { store, fixture } = setup();

    await expect(beginLocation(store, fixture, overrides)).rejects.toThrow(DomainError);
    expect(store.periodCloses.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });
});

describe("lockPeriodClose", () => {
  it("locks a closing close and records the lock pair and audit", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);

    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    expect(locked).toMatchObject({
      status: "locked",
      lockedBy: fixture.actorId,
    });
    expect(locked.lockedAt).not.toBeNull();
    expect(store.audits.find((row) => row.action === "close.period_close.locked")).toMatchObject({
      entityId: opened.id,
      after: expect.objectContaining({ status: "locked" }),
    });
  });

  it("is idempotent when already locked (no new audit fact)", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);
    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    const again = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    expect(again).toEqual(locked);
    expect(store.audits.filter((row) => row.action === "close.period_close.locked")).toHaveLength(
      1,
    );
  });

  it("rejects a close that is not closing", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);
    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });
    await reopenPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: locked.id,
      reason: "correction",
    });

    await expect(
      lockPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        periodCloseId: opened.id,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("throws NotFoundError for a missing or cross-organization id", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);

    await expect(
      lockPeriodClose(store, {
        organizationId: fixture.otherOrganizationId,
        actorId: fixture.actorId,
        periodCloseId: opened.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("reopenPeriodClose", () => {
  async function lockOne(store: FakePeriodCloseStore, fixture: PeriodCloseFixture) {
    const opened = await beginLocation(store, fixture);
    return lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });
  }

  it("reopens a locked close with the reason and audit", async () => {
    const { store, fixture } = setup();
    const locked = await lockOne(store, fixture);

    const reopened = await reopenPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: locked.id,
      reason: "  correction needed  ",
    });

    expect(reopened).toMatchObject({
      status: "reopened",
      reopenedBy: fixture.actorId,
      reopenReason: "correction needed",
    });
    expect(reopened.reopenedAt).not.toBeNull();
    const audit = store.audits.find((row) => row.action === "close.period_close.reopened");
    expect(audit).toMatchObject({
      entityId: locked.id,
      reason: "correction needed",
      after: expect.objectContaining({ status: "reopened" }),
    });
  });

  it("rejects an empty reason before touching the store", async () => {
    const { store, fixture } = setup();
    const locked = await lockOne(store, fixture);

    await expect(
      reopenPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        periodCloseId: locked.id,
        reason: "   ",
      }),
    ).rejects.toThrow(DomainError);
    expect(store.periodCloses.get(locked.id)?.status).toBe("locked");
  });

  it("rejects reopening a close that is not locked", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);

    await expect(
      reopenPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        periodCloseId: opened.id,
        reason: "correction",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("throws NotFoundError for a missing id", async () => {
    const { store, fixture } = setup();

    await expect(
      reopenPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        periodCloseId: "missing",
        reason: "correction",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("findPeriodClose / listPeriodCloses / isPeriodLocked", () => {
  it("scopes reads to the organization", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);

    expect(
      await findPeriodClose(store, {
        organizationId: fixture.organizationId,
        periodCloseId: opened.id,
      }),
    ).toMatchObject({ id: opened.id });
    expect(
      await findPeriodClose(store, {
        organizationId: fixture.otherOrganizationId,
        periodCloseId: opened.id,
      }),
    ).toBeUndefined();
    expect(await listPeriodCloses(store, { organizationId: fixture.otherOrganizationId })).toEqual(
      [],
    );
  });

  it("lists newest period first with filters and a bounded page", async () => {
    const { store, fixture } = setup();
    await beginLocation(store, fixture, { periodStart: "2026-03-05" });
    await beginPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      scopeType: "company",
      scopeId: fixture.organizationId,
      periodStart: "2026-04-01",
      checklist: [],
    });

    const rows = await listPeriodCloses(store, {
      organizationId: fixture.organizationId,
      limit: DEFAULT_PERIOD_CLOSE_LIMIT,
    });
    expect(rows.map((row) => row.periodStart)).toEqual(["2026-04-01", "2026-03-05"]);

    const filtered = await listPeriodCloses(store, {
      organizationId: fixture.organizationId,
      scopeType: "location",
      status: "closing",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.scopeType).toBe("location");
  });

  it("rejects a bogus status or scope filter", async () => {
    const { store, fixture } = setup();

    await expect(
      listPeriodCloses(store, { organizationId: fixture.organizationId, status: "bogus" }),
    ).rejects.toThrow(DomainError);
    await expect(
      listPeriodCloses(store, { organizationId: fixture.organizationId, scopeType: "bogus" }),
    ).rejects.toThrow(DomainError);
  });

  it("answers whether a scope is locked at a date", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);

    expect(
      await isPeriodLocked(store, {
        organizationId: fixture.organizationId,
        scopeType: "location",
        scopeId: fixture.locationId,
        at: fixture.day,
      }),
    ).toEqual({ locked: false });

    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    expect(
      await isPeriodLocked(store, {
        organizationId: fixture.organizationId,
        scopeType: "location",
        scopeId: fixture.locationId,
        at: fixture.day,
      }),
    ).toEqual({ locked: true, periodClose: locked });

    expect(
      await isPeriodLocked(store, {
        organizationId: fixture.organizationId,
        scopeType: "location",
        scopeId: fixture.locationId,
        at: "2026-03-06",
      }),
    ).toEqual({ locked: false });
  });
});

describe("transaction rollback", () => {
  it("restores the maps and audits when a transaction callback throws", async () => {
    const { store, fixture } = setup();
    await beginLocation(store, fixture);
    const before = new Map(store.periodCloses);
    const auditsBefore = store.audits.length;

    await expect(
      store.withTransaction(async (tx) => {
        await tx.createPeriodClose({
          organizationId: fixture.organizationId,
          scopeType: "location",
          scopeId: fixture.locationId,
          periodStart: "2026-04-01",
          periodEnd: "2026-04-01",
          status: "closing",
          checklist: [],
          snapshot: null,
          createdBy: fixture.actorId,
        });
        await tx.writeAudit({
          organizationId: fixture.organizationId,
          actorId: fixture.actorId,
          action: "close.period_close.started",
          entityType: "period_close",
          entityId: null,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.periodCloses).toEqual(before);
    expect(store.audits).toHaveLength(auditsBefore);
  });
});
