import { DomainError } from "@aquarela/domain";
import type { ToleranceKind } from "@aquarela/domain";

import type { AuditInput } from "../auth";

import { DEFAULT_PERIOD_CLOSE_LIMIT } from "./list-period-closes";
import type {
  NewPeriodCloseRecord,
  PeriodCloseListQuery,
  PeriodCloseRecord,
  PeriodCloseStore,
  PeriodOverlapRecord,
  PeriodWindowQuery,
  UpdatePeriodCloseRecord,
} from "./types";

/**
 * A prerequisite source row in the fake: the `status` the evaluation reads plus
 * the `period_start`/`period_end` the overlap filter uses. The organization is
 * carried so the fake mirrors the adapter's `DEC-061` scoping.
 */
export interface FakePeriodOverlapRow {
  readonly organizationId: string;
  readonly status: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
}

/**
 * A seeded `reconciliation_tolerance` in the fake: the half-open
 * `[effectiveFrom, effectiveTo)` window `findReconciliationTolerance` reads,
 * mirroring `repositories/reconciliation.ts`.
 */
export interface FakeReconciliationTolerance {
  /** `date`, `YYYY-MM-DD`, inclusive. */
  readonly effectiveFrom: string;
  /** `date`, `YYYY-MM-DD`, exclusive; `null` is open-ended. */
  readonly effectiveTo: string | null;
}

/**
 * A shallow copy of every mutable map/array a close transaction can touch, used
 * to roll back a failed `withTransaction` (the fake runs inline without one).
 * The prerequisite fixture maps are included even though the current commands
 * only read them: a future writing command must not silently skip rollback.
 */
interface PeriodCloseSnapshot {
  readonly periodCloses: Map<string, PeriodCloseRecord>;
  readonly audits: AuditInput[];
  readonly reconciliations: FakePeriodOverlapRow[];
  readonly importRuns: FakePeriodOverlapRow[];
  readonly openDataQualityExceptions: Map<string, number>;
  readonly reconciliationTolerances: Map<string, FakeReconciliationTolerance>;
}

/**
 * In-memory `PeriodCloseStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, ordering (`period_start desc`, then id) and
 * paging so the commands and queries can be exercised without a database;
 * `close.postgres.test.ts` covers the real adapter.
 */
export class FakePeriodCloseStore implements PeriodCloseStore {
  readonly periodCloses = new Map<string, PeriodCloseRecord>();
  readonly audits: AuditInput[] = [];

  // `DEC-107` prerequisite fixtures: tests seed these directly. A command only
  // reads them today, but they are part of the transaction snapshot so a future
  // writing command rolls back like the real adapter.
  readonly reconciliations: FakePeriodOverlapRow[] = [];
  readonly importRuns: FakePeriodOverlapRow[] = [];
  /** organization id → open (`open`/`acknowledged`) exception count. */
  readonly openDataQualityExceptions = new Map<string, number>();
  /** `${organizationId}:${kind}` → the effective tolerance. */
  readonly reconciliationTolerances = new Map<string, FakeReconciliationTolerance>();

  private sequence = 0;

  private nextId(): string {
    this.sequence += 1;
    return `period-close-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: PeriodCloseStore) => Promise<T>): Promise<T> {
    // Snapshot then run so a failure mid-transaction rolls back every write
    // (a command and its audit fact commit or roll back together, like the
    // Postgres adapter).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): PeriodCloseSnapshot {
    return {
      periodCloses: new Map(this.periodCloses),
      audits: [...this.audits],
      reconciliations: [...this.reconciliations],
      importRuns: [...this.importRuns],
      openDataQualityExceptions: new Map(this.openDataQualityExceptions),
      reconciliationTolerances: new Map(this.reconciliationTolerances),
    };
  }

  private restore(snapshot: PeriodCloseSnapshot): void {
    this.periodCloses.clear();
    for (const [key, value] of snapshot.periodCloses) this.periodCloses.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
    this.reconciliations.length = 0;
    this.reconciliations.push(...snapshot.reconciliations);
    this.importRuns.length = 0;
    this.importRuns.push(...snapshot.importRuns);
    this.openDataQualityExceptions.clear();
    for (const [key, value] of snapshot.openDataQualityExceptions) {
      this.openDataQualityExceptions.set(key, value);
    }
    this.reconciliationTolerances.clear();
    for (const [key, value] of snapshot.reconciliationTolerances) {
      this.reconciliationTolerances.set(key, value);
    }
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createPeriodClose(input: NewPeriodCloseRecord): Promise<PeriodCloseRecord> {
    // Mirror the Postgres `period_close_org_scope_period_key` unique: a second
    // row for the same scope and period is a conflict (the `beginPeriodClose`
    // create race-safe catch re-reads and treats this as an idempotent no-op).
    const duplicate = await this.findPeriodCloseForScope({
      organizationId: input.organizationId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: input.periodStart,
    });
    if (duplicate !== undefined) {
      throw new DomainError("period close already exists for this scope and period");
    }
    const record: PeriodCloseRecord = {
      id: this.nextId(),
      organizationId: input.organizationId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      checklist: input.checklist,
      snapshot: input.snapshot,
      correctionPolicy: null,
      lockedBy: null,
      lockedAt: null,
      reopenedBy: null,
      reopenedAt: null,
      reopenReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.periodCloses.set(record.id, record);
    return record;
  }

  /** The `DEC-107` overlap filter, organization-scoped: `[start, end]` vs `[from, to]`. */
  async listReconciliationsForPeriod(
    query: PeriodWindowQuery,
  ): Promise<readonly PeriodOverlapRecord[]> {
    return this.overlapping(this.reconciliations, query);
  }

  async listImportRunsForPeriod(query: PeriodWindowQuery): Promise<readonly PeriodOverlapRecord[]> {
    return this.overlapping(this.importRuns, query);
  }

  private overlapping(
    rows: readonly FakePeriodOverlapRow[],
    query: PeriodWindowQuery,
  ): readonly PeriodOverlapRecord[] {
    return rows
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          row.periodStart <= query.to &&
          row.periodEnd >= query.from,
      )
      .map((row) => ({ status: row.status }));
  }

  async countOpenDataQualityExceptions(query: {
    readonly organizationId: string;
  }): Promise<number> {
    return this.openDataQualityExceptions.get(query.organizationId) ?? 0;
  }

  /**
   * The effective tolerance at `asOf`, mirroring
   * `repositories/reconciliation.ts`: half-open `[effectiveFrom, effectiveTo)`,
   * so `effectiveFrom <= asOf` and `(effectiveTo === null || asOf < effectiveTo)`.
   * A seeded window that does not contain `asOf` resolves to `undefined`.
   */
  async findReconciliationTolerance(query: {
    readonly organizationId: string;
    readonly kind: ToleranceKind;
    readonly asOf: string;
  }): Promise<FakeReconciliationTolerance | undefined> {
    const tolerance = this.reconciliationTolerances.get(`${query.organizationId}:${query.kind}`);
    if (tolerance === undefined) return undefined;
    if (tolerance.effectiveFrom > query.asOf) return undefined;
    if (tolerance.effectiveTo !== null && query.asOf >= tolerance.effectiveTo) return undefined;
    return tolerance;
  }

  async findPeriodClose(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<PeriodCloseRecord | undefined> {
    const close = this.periodCloses.get(query.id);
    return close !== undefined && close.organizationId === query.organizationId ? close : undefined;
  }

  /** The fake has no row locks, so locking is the same id read. */
  async lockPeriodCloseById(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<PeriodCloseRecord | undefined> {
    return this.findPeriodClose(query);
  }

  async findPeriodCloseForScope(query: {
    readonly organizationId: string;
    readonly scopeType: string;
    readonly scopeId: string;
    readonly periodStart: string;
  }): Promise<PeriodCloseRecord | undefined> {
    return [...this.periodCloses.values()].find(
      (close) =>
        close.organizationId === query.organizationId &&
        close.scopeType === query.scopeType &&
        close.scopeId === query.scopeId &&
        close.periodStart === query.periodStart,
    );
  }

  /** The fake has no row locks, so locking is the same scope read. */
  async lockPeriodCloseForScope(query: {
    readonly organizationId: string;
    readonly scopeType: string;
    readonly scopeId: string;
    readonly periodStart: string;
  }): Promise<PeriodCloseRecord | undefined> {
    return this.findPeriodCloseForScope(query);
  }

  async findLockedPeriodCloseCoveringDate(query: {
    readonly organizationId: string;
    readonly scopeType: string;
    readonly scopeId: string;
    readonly at: string;
  }): Promise<PeriodCloseRecord | undefined> {
    return [...this.periodCloses.values()].find(
      (close) =>
        close.organizationId === query.organizationId &&
        close.scopeType === query.scopeType &&
        close.scopeId === query.scopeId &&
        close.status === "locked" &&
        close.periodStart <= query.at &&
        close.periodEnd >= query.at,
    );
  }

  async listPeriodCloses(query: PeriodCloseListQuery): Promise<readonly PeriodCloseRecord[]> {
    // Insertion order, so the tie-break matches the Postgres `id asc` observable
    // order for the same inserts (the fake's generated ids are insertion-ordered).
    const insertionOrder = new Map<string, number>();
    let index = 0;
    for (const id of this.periodCloses.keys()) {
      insertionOrder.set(id, index);
      index += 1;
    }
    const rows = [...this.periodCloses.values()]
      .filter((close) => close.organizationId === query.organizationId)
      .filter((close) => query.scopeType === undefined || close.scopeType === query.scopeType)
      .filter((close) => query.scopeId === undefined || close.scopeId === query.scopeId)
      .filter((close) => query.status === undefined || close.status === query.status)
      .filter((close) => query.from === undefined || close.periodStart >= query.from)
      .filter((close) => query.to === undefined || close.periodStart <= query.to)
      .sort((a, b) => {
        // Persistence order: `period_start desc`, then id asc (insertion order).
        if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
        return (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0);
      });
    const offset = query.offset ?? 0;
    // Mirror the Postgres adapter and the commands: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_PERIOD_CLOSE_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async updatePeriodClose(input: UpdatePeriodCloseRecord): Promise<PeriodCloseRecord | undefined> {
    const existing = await this.findPeriodClose({
      organizationId: input.organizationId,
      id: input.periodCloseId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: PeriodCloseRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.checklist === undefined ? {} : { checklist: input.checklist }),
      ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
      ...(input.correctionPolicy === undefined ? {} : { correctionPolicy: input.correctionPolicy }),
      ...(input.lockedBy === undefined ? {} : { lockedBy: input.lockedBy }),
      ...(input.lockedAt === undefined ? {} : { lockedAt: input.lockedAt }),
      ...(input.reopenedBy === undefined ? {} : { reopenedBy: input.reopenedBy }),
      ...(input.reopenedAt === undefined ? {} : { reopenedAt: input.reopenedAt }),
      ...(input.reopenReason === undefined ? {} : { reopenReason: input.reopenReason }),
      updatedAt: new Date().toISOString(),
    };
    this.periodCloses.set(record.id, record);
    return record;
  }
}

export interface PeriodCloseFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
  readonly day: string;
  readonly monthStart: string;
}

/**
 * Seeds the two-organization fixture the close tests share: a location id in
 * each organization so a location close can be opened in one and read from the
 * other, plus one day and one month start.
 */
export function seedPeriodCloseFixture(): PeriodCloseFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    locationId: "loc-1",
    otherLocationId: "loc-2",
    day: "2026-03-05",
    monthStart: "2026-03-01",
  };
}
