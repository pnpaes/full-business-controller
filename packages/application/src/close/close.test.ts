import { DomainError, NotFoundError } from "@aquarela/domain";
import type { CloseSnapshot } from "@aquarela/domain";
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
  type FakePeriodOverlapRow,
  type PeriodCloseFixture,
} from "./test-support";
import { PERIOD_CLOSE_SCOPE_TYPES, PERIOD_CLOSE_STATUSES } from "./types";
import type { PeriodCloseRecord } from "./types";

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
    expect((close.snapshot as { schemaVersion: number }).schemaVersion).toBe(2);
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

  it("recovers a create race from a fresh transaction outside the failed one (F1)", async () => {
    const { store, fixture } = setup();
    const seeded = await beginLocation(store, fixture);
    const auditsAfterSeed = store.audits.length;

    // Simulate the loser of a concurrent create: the scope lock read misses (the
    // winner's row was not visible yet), then the INSERT collides on the unique.
    const racing = Object.create(store) as FakePeriodCloseStore;
    racing.lockPeriodCloseForScope = async () => undefined;

    // On Postgres the failed transaction is aborted, so the recovery re-read must
    // run **outside** it. Track transaction depth and flag a read outside one.
    let inTransaction = false;
    let reReadOutsideTransaction = false;
    const runTransaction = store.withTransaction.bind(racing);
    racing.withTransaction = async (fn) => {
      inTransaction = true;
      try {
        return await runTransaction(fn);
      } finally {
        inTransaction = false;
      }
    };
    const findForScope = store.findPeriodCloseForScope.bind(racing);
    racing.findPeriodCloseForScope = async (query) => {
      if (!inTransaction) reReadOutsideTransaction = true;
      return findForScope(query);
    };

    const result = await beginPeriodClose(racing, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      scopeType: "location",
      scopeId: fixture.locationId,
      periodStart: fixture.day,
      checklist: [],
    });

    expect(result.id).toBe(seeded.id);
    expect(reReadOutsideTransaction).toBe(true);
    expect(store.audits).toHaveLength(auditsAfterSeed);
  });

  it("surfaces a locked create-race winner as the locked DomainError (F1)", async () => {
    const { store, fixture } = setup();
    const winner = await beginLocation(store, fixture);
    await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: winner.id,
    });

    // The loser misses the lock read, so it reaches the INSERT; the fresh-
    // transaction recovery then finds the winner and must honour its locked status.
    const racing = Object.create(store) as FakePeriodCloseStore;
    racing.lockPeriodCloseForScope = async () => undefined;

    await expect(
      beginPeriodClose(racing, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: fixture.day,
        checklist: [],
      }),
    ).rejects.toThrow("period is locked; reopen it first");
  });

  it("rethrows the original error when the recovery re-read finds no row (F1)", async () => {
    const { store, fixture } = setup();

    const failing = Object.create(store) as FakePeriodCloseStore;
    failing.createPeriodClose = async () => {
      throw new DomainError("insert rejected by the database");
    };

    await expect(
      beginPeriodClose(failing, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: fixture.day,
        checklist: [],
      }),
    ).rejects.toThrow("insert rejected by the database");
  });

  it("does not attempt race recovery when the INSERT was never reached (F1)", async () => {
    const { store, fixture } = setup();

    const failing = Object.create(store) as FakePeriodCloseStore;
    failing.lockPeriodCloseForScope = async () => {
      throw new Error("lock read failed");
    };

    await expect(
      beginPeriodClose(failing, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: fixture.day,
        checklist: [],
      }),
    ).rejects.toThrow("lock read failed");
  });

  it("keeps a blocker failure for an existing reopenable close instead of returning it (F1)", async () => {
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
    // A blocker now exists: re-beginning the reopened close must fail; the
    // recovery must not mistake the pre-existing row for a create-race winner.
    store.reconciliations.push({
      organizationId: fixture.organizationId,
      status: "pending",
      periodStart: fixture.day,
      periodEnd: fixture.day,
    });

    await expect(beginLocation(store, fixture)).rejects.toThrow(/cannot close location/);
    expect(store.periodCloses.get(opened.id)?.status).toBe("reopened");
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

describe("beginPeriodClose prerequisites (DEC-107)", () => {
  function seedReconciliation(
    store: FakePeriodCloseStore,
    fixture: PeriodCloseFixture,
    overrides: Partial<FakePeriodOverlapRow> = {},
  ): void {
    store.reconciliations.push({
      organizationId: fixture.organizationId,
      status: "pending",
      periodStart: fixture.day,
      periodEnd: fixture.day,
      ...overrides,
    });
  }

  function seedImportRun(
    store: FakePeriodCloseStore,
    fixture: PeriodCloseFixture,
    overrides: Partial<FakePeriodOverlapRow> = {},
  ): void {
    store.importRuns.push({
      organizationId: fixture.organizationId,
      status: "validated",
      periodStart: fixture.day,
      periodEnd: fixture.day,
      ...overrides,
    });
  }

  function snapshotOf(close: PeriodCloseRecord): CloseSnapshot {
    return close.snapshot as CloseSnapshot;
  }

  it("freezes the version-2 prerequisite block when nothing blocks", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, { status: "approved" });
    store.reconciliationTolerances.set(`${fixture.organizationId}:sales_settlement`, {
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    store.openDataQualityExceptions.set(fixture.organizationId, 2);

    const close = await beginLocation(store, fixture);
    const snapshot = snapshotOf(close);

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.prerequisites).toEqual({
      reconciliations: {
        total: 1,
        byStatus: {
          pending: 0,
          within_tolerance: 0,
          exception: 0,
          resolved: 0,
          approved: 1,
        },
        blocking: 0,
      },
      importRuns: {
        total: 0,
        byStatus: {
          uploaded: 0,
          parsed: 0,
          needs_review: 0,
          validated: 0,
          posted: 0,
          partially_posted: 0,
          failed: 0,
          superseded: 0,
        },
        blocking: 0,
      },
      exceptions: { open: 2 },
      tolerances: { sales_settlement: true, supplier_invoice: false },
      scopeLimited: true,
    });
  });

  it("sets scopeLimited false for a company scope", async () => {
    const { store, fixture } = setup();

    const close = await beginPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      scopeType: "company",
      scopeId: fixture.organizationId,
      periodStart: fixture.monthStart,
      checklist: [],
    });

    expect(snapshotOf(close).prerequisites.scopeLimited).toBe(false);
  });

  it.each([
    ["pending", "pending"],
    ["exception", "exception"],
  ])("blocks on a %s reconciliation and writes nothing", async (_label, status) => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, { status });

    await expect(beginLocation(store, fixture)).rejects.toThrow(DomainError);
    await expect(beginLocation(store, fixture)).rejects.toThrow(
      /cannot close location 2026-03-05: 1 reconciliation\(s\) unresolved \(pending\/exception\)/,
    );
    expect(store.periodCloses.size).toBe(0);
    expect(store.audits).toHaveLength(0);
  });

  it.each([["parsed"], ["needs_review"], ["validated"], ["partially_posted"]])(
    "blocks on a %s import run through beginPeriodClose",
    async (status) => {
      const { store, fixture } = setup();
      seedImportRun(store, fixture, { status });

      await expect(beginLocation(store, fixture)).rejects.toThrow(
        /cannot close location 2026-03-05: 1 import run\(s\) not closed/,
      );
      expect(store.periodCloses.size).toBe(0);
      expect(store.audits).toHaveLength(0);
    },
  );

  it("does not block on a posted import run", async () => {
    const { store, fixture } = setup();
    seedImportRun(store, fixture, { status: "posted" });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.importRuns.byStatus.posted).toBe(1);
    expect(snapshotOf(close).prerequisites.importRuns.blocking).toBe(0);
    expect(store.periodCloses.size).toBe(1);
  });

  it("does not block on a within_tolerance or resolved reconciliation", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, { status: "within_tolerance" });
    seedReconciliation(store, fixture, { status: "resolved" });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.reconciliations.byStatus).toMatchObject({
      within_tolerance: 1,
      resolved: 1,
    });
    expect(snapshotOf(close).prerequisites.reconciliations.blocking).toBe(0);
    expect(store.periodCloses.size).toBe(1);
  });

  it("names both blocking sources in one error", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, { status: "pending" });
    seedImportRun(store, fixture, { status: "uploaded" });

    await expect(beginLocation(store, fixture)).rejects.toThrow(
      /1 reconciliation\(s\) unresolved \(pending\/exception\) and 1 import run\(s\) not closed/,
    );
  });

  it("does not block on a non-overlapping pending reconciliation", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.reconciliations.total).toBe(0);
    expect(store.periodCloses.size).toBe(1);
  });

  it("counts a source ending on the close day as overlapping", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      periodStart: "2026-02-01",
      periodEnd: fixture.day,
    });

    await expect(beginLocation(store, fixture)).rejects.toThrow(DomainError);
  });

  it("treats a source starting on a company close's periodEnd as overlapping (inclusive edge)", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      periodStart: "2026-03-31",
      periodEnd: "2026-03-31",
    });

    await expect(
      beginPeriodClose(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        scopeType: "company",
        scopeId: fixture.organizationId,
        periodStart: fixture.monthStart,
        checklist: [],
      }),
    ).rejects.toThrow(/cannot close company 2026-03-01/);
  });

  it("treats a source fully spanning the close period as overlapping", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });

    await expect(beginLocation(store, fixture)).rejects.toThrow(DomainError);
  });

  it("does not block on a source starting after the close period", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      periodStart: "2026-03-06",
      periodEnd: "2026-03-31",
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.reconciliations.total).toBe(0);
  });

  it("scopes the prerequisite reads to the organization", async () => {
    const { store, fixture } = setup();
    seedReconciliation(store, fixture, {
      organizationId: fixture.otherOrganizationId,
      status: "pending",
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.reconciliations.total).toBe(0);
  });

  it("never blocks on open exceptions or a missing tolerance (informational)", async () => {
    const { store, fixture } = setup();
    store.openDataQualityExceptions.set(fixture.organizationId, 5);

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.exceptions).toEqual({ open: 5 });
    expect(snapshotOf(close).prerequisites.tolerances).toEqual({
      sales_settlement: false,
      supplier_invoice: false,
    });
    expect(store.periodCloses.size).toBe(1);
  });

  it("ignores an expired tolerance at the period end", async () => {
    const { store, fixture } = setup();
    store.reconciliationTolerances.set(`${fixture.organizationId}:sales_settlement`, {
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-02-01",
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.tolerances.sales_settlement).toBe(false);
  });

  it("ignores a not-yet-effective tolerance at the period end", async () => {
    const { store, fixture } = setup();
    store.reconciliationTolerances.set(`${fixture.organizationId}:sales_settlement`, {
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.tolerances.sales_settlement).toBe(false);
  });

  it("treats the tolerance effectiveTo boundary as exclusive", async () => {
    const { store, fixture } = setup();
    // effectiveTo equals the close day, so the half-open window does NOT cover it.
    store.reconciliationTolerances.set(`${fixture.organizationId}:sales_settlement`, {
      effectiveFrom: "2026-03-01",
      effectiveTo: fixture.day,
    });
    store.reconciliationTolerances.set(`${fixture.organizationId}:supplier_invoice`, {
      effectiveFrom: "2026-03-01",
      effectiveTo: "2026-04-01",
    });

    const close = await beginLocation(store, fixture);

    expect(snapshotOf(close).prerequisites.tolerances).toEqual({
      sales_settlement: false,
      supplier_invoice: true,
    });
  });

  it("reads a stored version-1 snapshot (no prerequisites) back unchanged", async () => {
    const { store, fixture } = setup();
    const legacySnapshot = {
      schemaVersion: 1,
      scopeType: "location",
      scopeId: fixture.locationId,
      periodStart: fixture.day,
      periodEnd: fixture.day,
      capturedAt: "2026-03-05T22:00:00.000Z",
      checklist: [{ key: "cash_counted", label: "Count the till", done: true }],
    };
    store.periodCloses.set("legacy-1", {
      id: "legacy-1",
      organizationId: fixture.organizationId,
      scopeType: "location",
      scopeId: fixture.locationId,
      periodStart: fixture.day,
      periodEnd: fixture.day,
      status: "closing",
      checklist: legacySnapshot.checklist,
      snapshot: legacySnapshot,
      correctionPolicy: null,
      lockedBy: null,
      lockedAt: null,
      reopenedBy: null,
      reopenedAt: null,
      reopenReason: null,
      createdAt: "2026-03-05T21:00:00.000Z",
      updatedAt: null,
    });

    const found = await findPeriodClose(store, {
      organizationId: fixture.organizationId,
      periodCloseId: "legacy-1",
    });
    expect(found?.snapshot).toEqual(legacySnapshot);
    expect((found?.snapshot as { prerequisites?: unknown }).prerequisites).toBeUndefined();

    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: "legacy-1",
    });
    expect(locked.snapshot).toEqual(legacySnapshot);
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

  it("does not re-evaluate prerequisites at lock time", async () => {
    const { store, fixture } = setup();
    const opened = await beginLocation(store, fixture);
    // A blocker appearing after begin must not affect the frozen snapshot: lock
    // freezes the close as begun and deliberately does not re-run the gate.
    store.reconciliations.push({
      organizationId: fixture.organizationId,
      status: "pending",
      periodStart: fixture.day,
      periodEnd: fixture.day,
    });

    const locked = await lockPeriodClose(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      periodCloseId: opened.id,
    });

    expect(locked.status).toBe("locked");
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
