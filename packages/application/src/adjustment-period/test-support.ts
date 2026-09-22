import type { AuditInput } from "../auth";

import { DEFAULT_ADJUSTMENT_PERIOD_LIMIT } from "./list-adjustment-periods";
import type {
  AdjustmentPeriodListQuery,
  AdjustmentPeriodRecord,
  AdjustmentPeriodStore,
  NewAdjustmentPeriodRecord,
  UpdateAdjustmentPeriodRecord,
} from "./types";

/**
 * A shallow copy of every mutable map/array an adjustment-period transaction can
 * touch, used to roll back a failed `withTransaction` (the fake runs inline
 * without one).
 */
interface AdjustmentPeriodSnapshot {
  readonly periods: Map<string, AdjustmentPeriodRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `AdjustmentPeriodStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, ordering (`opened_from desc`, then id) and
 * paging so the commands and queries can be exercised without a database;
 * `adjustment-period.postgres.test.ts` covers the real adapter.
 */
export class FakeAdjustmentPeriodStore implements AdjustmentPeriodStore {
  readonly periods = new Map<string, AdjustmentPeriodRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(): string {
    this.sequence += 1;
    return `adjustment-period-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: AdjustmentPeriodStore) => Promise<T>): Promise<T> {
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

  private snapshot(): AdjustmentPeriodSnapshot {
    return {
      periods: new Map(this.periods),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: AdjustmentPeriodSnapshot): void {
    this.periods.clear();
    for (const [key, value] of snapshot.periods) this.periods.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createAdjustmentPeriod(input: NewAdjustmentPeriodRecord): Promise<AdjustmentPeriodRecord> {
    // Mirror the Postgres `adjustment_period_open_key` partial unique: a second
    // `open` row for the organization is a conflict (the `openAdjustmentPeriod`
    // create-race-safe catch re-reads and returns the winner). A plain `Error`,
    // not a `DomainError`, so the fake's error shape matches the driver's 23505
    // and the out-of-transaction recovery is exercised realistically.
    if (input.status === "open") {
      const open = await this.findOpenAdjustmentPeriod({ organizationId: input.organizationId });
      if (open !== undefined) {
        throw new Error("duplicate open adjustment period (adjustment_period_open_key)");
      }
    }
    const record: AdjustmentPeriodRecord = {
      id: this.nextId(),
      organizationId: input.organizationId,
      openedFrom: input.openedFrom,
      openedTo: input.openedTo,
      reason: input.reason,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      status: input.status,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.periods.set(record.id, record);
    return record;
  }

  async findAdjustmentPeriod(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<AdjustmentPeriodRecord | undefined> {
    const period = this.periods.get(query.id);
    return period !== undefined && period.organizationId === query.organizationId
      ? period
      : undefined;
  }

  /** The fake has no row locks, so locking is the same id read. */
  async lockAdjustmentPeriodById(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<AdjustmentPeriodRecord | undefined> {
    return this.findAdjustmentPeriod(query);
  }

  async findOpenAdjustmentPeriod(query: {
    readonly organizationId: string;
  }): Promise<AdjustmentPeriodRecord | undefined> {
    return [...this.periods.values()].find(
      (period) => period.organizationId === query.organizationId && period.status === "open",
    );
  }

  async listAdjustmentPeriods(
    query: AdjustmentPeriodListQuery,
  ): Promise<readonly AdjustmentPeriodRecord[]> {
    // Insertion order, so the tie-break matches the Postgres `id asc` observable
    // order for the same inserts (the fake's generated ids are insertion-ordered).
    const insertionOrder = new Map<string, number>();
    let index = 0;
    for (const id of this.periods.keys()) {
      insertionOrder.set(id, index);
      index += 1;
    }
    const rows = [...this.periods.values()]
      .filter((period) => period.organizationId === query.organizationId)
      .filter((period) => query.status === undefined || period.status === query.status)
      .filter((period) => query.from === undefined || period.openedFrom >= query.from)
      .filter((period) => query.to === undefined || period.openedFrom <= query.to)
      .sort((a, b) => {
        // Persistence order: `opened_from desc`, then id asc (insertion order).
        if (a.openedFrom !== b.openedFrom) return a.openedFrom < b.openedFrom ? 1 : -1;
        return (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0);
      });
    const offset = query.offset ?? 0;
    // Mirror the Postgres adapter and the commands: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_ADJUSTMENT_PERIOD_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async updateAdjustmentPeriod(
    input: UpdateAdjustmentPeriodRecord,
  ): Promise<AdjustmentPeriodRecord | undefined> {
    const existing = await this.findAdjustmentPeriod({
      organizationId: input.organizationId,
      id: input.adjustmentPeriodId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: AdjustmentPeriodRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.approvedBy === undefined ? {} : { approvedBy: input.approvedBy }),
      ...(input.approvedAt === undefined ? {} : { approvedAt: input.approvedAt }),
      updatedAt: new Date().toISOString(),
    };
    this.periods.set(record.id, record);
    return record;
  }
}

export interface AdjustmentPeriodFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly openedFrom: string;
  readonly openedTo: string;
  readonly reason: string;
}

/**
 * Seeds the two-organization fixture the adjustment-period tests share: an open
 * window in one organization so a read can be attempted from the other.
 */
export function seedAdjustmentPeriodFixture(): AdjustmentPeriodFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    openedFrom: "2026-03-01",
    openedTo: "2026-03-05",
    reason: "late invoice corrections",
  };
}
