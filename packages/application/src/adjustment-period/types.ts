import { ADJUSTMENT_PERIOD_STATUS } from "@aquarela/persistence";

import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the adjustment-period slice (`REC-006`,
 * `DEC-027`, row 13b).
 *
 * `adjustment_period` carries `organization_id` directly and has no location
 * dimension, so every read and write takes the organization and is scoped by it
 * (`DEC-061`). `opened_from`/`opened_to` cross the port as `YYYY-MM-DD` strings
 * and the instants (`approvedAt`/`createdAt`/`updatedAt`) as ISO strings. The
 * status vocabulary comes from the persistence `adjustment_period_status` enum so
 * there is one source of truth.
 *
 * This is a **different domain from close/lock**, so it has its own
 * `AdjustmentPeriodStore` port rather than extending `PeriodCloseStore`.
 */

/** The `adjustment_period_status` vocabulary (`ADJUSTMENT_PERIOD_STATUS`). */
export const ADJUSTMENT_PERIOD_STATUSES: readonly string[] = ADJUSTMENT_PERIOD_STATUS;

/** Narrow type for `adjustment_period.status`, so comparisons cannot drift. */
export type AdjustmentPeriodStatus = (typeof ADJUSTMENT_PERIOD_STATUS)[number];

/**
 * One `adjustment_period` row (`REC-006`, `DEC-027`). A correction window
 * `[openedFrom, openedTo]` with a required `reason`; `approvedBy`/`approvedAt`
 * are the single-stage approval pair (both set or both null at the database).
 * Dates are `YYYY-MM-DD`, instants ISO.
 */
export interface AdjustmentPeriodRecord {
  readonly id: string;
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly openedFrom: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly openedTo: string;
  readonly reason: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO; null until approved. */
  readonly approvedAt: string | null;
  /** One of `ADJUSTMENT_PERIOD_STATUSES`. */
  readonly status: string;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

export interface NewAdjustmentPeriodRecord {
  readonly organizationId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly openedFrom: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly openedTo: string;
  readonly reason: string;
  /** One of `ADJUSTMENT_PERIOD_STATUSES`. */
  readonly status: AdjustmentPeriodStatus;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO, or null. */
  readonly approvedAt: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * The mutable fields of an adjustment period. `undefined` means "leave as is";
 * `null` clears an optional field. `openedFrom`/`openedTo`/`reason` are not
 * exposed (immutable after creation); the lifecycle command sets `status` and the
 * approval pair through this port.
 *
 * ponytail: the `approvedBy`/`approvedAt` clears are exposed for the planned
 * two-stage approval flow (open → approved) but no current command clears them.
 * Ceiling: the clears are dead surface until that flow exists. Upgrade path: keep
 * the columns and drop these two fields (or fold them into a dedicated `approve`
 * command) once the two-stage flow is the only writer.
 */
export interface UpdateAdjustmentPeriodRecord {
  readonly organizationId: string;
  readonly adjustmentPeriodId: string;
  /** One of `ADJUSTMENT_PERIOD_STATUSES`. */
  readonly status?: AdjustmentPeriodStatus;
  readonly approvedBy?: string | null;
  /** `timestamptz`, ISO, or null. */
  readonly approvedAt?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/** Adjustment-period filters for the store read. */
export interface AdjustmentPeriodListQuery {
  readonly organizationId: string;
  /** One of `ADJUSTMENT_PERIOD_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `opened_from`; `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `opened_from`; `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the adjustment-period slice. One port covers the one
 * table, mirroring the persistence repository module.
 * `lockAdjustmentPeriodById` takes the row's write lock so concurrent `close`
 * calls serialise; `findOpenAdjustmentPeriod` answers the one-open-period-per-org
 * read (backed by the partial unique `adjustment_period_open_key`).
 */
export interface AdjustmentPeriodStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: AdjustmentPeriodStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createAdjustmentPeriod(input: NewAdjustmentPeriodRecord): Promise<AdjustmentPeriodRecord>;
  /** One adjustment period by id, organization-scoped (`DEC-061`), or `undefined`. */
  findAdjustmentPeriod(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<AdjustmentPeriodRecord | undefined>;
  /**
   * The same id read as `findAdjustmentPeriod`, taking the row's write lock
   * (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction so two
   * concurrent `close` calls serialise instead of both passing the status check
   * and both writing an audit fact.
   */
  lockAdjustmentPeriodById(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<AdjustmentPeriodRecord | undefined>;
  /**
   * The organization's `open` adjustment period, or `undefined`. At most one can
   * exist (`adjustment_period_open_key`).
   */
  findOpenAdjustmentPeriod(query: {
    readonly organizationId: string;
  }): Promise<AdjustmentPeriodRecord | undefined>;
  listAdjustmentPeriods(
    query: AdjustmentPeriodListQuery,
  ): Promise<readonly AdjustmentPeriodRecord[]>;
  /**
   * Applies a patch to one adjustment period, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateAdjustmentPeriod(
    input: UpdateAdjustmentPeriodRecord,
  ): Promise<AdjustmentPeriodRecord | undefined>;
}
