import { PERIOD_CLOSE_SCOPE_TYPE, PERIOD_CLOSE_STATUS } from "@aquarela/persistence";

import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the close/lock slice (`REC-003`,
 * `REC-006`, `DEC-027`, row 13a).
 *
 * `period_close` carries `organization_id` directly, so every read and write
 * takes the organization and is scoped by it (`DEC-061`). `period_start`/
 * `period_end` cross the port as `YYYY-MM-DD` strings and the instants
 * (`lockedAt`/`reopenedAt`/`createdAt`/`updatedAt`) as ISO strings; the
 * `checklist`/`snapshot` jsonb are carried as `unknown` (the domain builders own
 * their shapes). The scope/status vocabularies come from the persistence
 * `period_close_scope_type`/`period_close_status` enums so there is one source of
 * truth.
 *
 * This is a **different domain from scheduling/workforce**, so it has its own
 * `PeriodCloseStore` port rather than extending another.
 */

/** The `period_close_scope_type` vocabulary (`PERIOD_CLOSE_SCOPE_TYPE`). */
export const PERIOD_CLOSE_SCOPE_TYPES: readonly string[] = PERIOD_CLOSE_SCOPE_TYPE;

/** The `period_close_status` vocabulary (`PERIOD_CLOSE_STATUS`). */
export const PERIOD_CLOSE_STATUSES: readonly string[] = PERIOD_CLOSE_STATUS;

/** Narrow type for `period_close.scope_type`, so comparisons cannot drift. */
export type PeriodCloseScopeType = (typeof PERIOD_CLOSE_SCOPE_TYPE)[number];

/** Narrow type for `period_close.status`, so comparisons cannot drift. */
export type PeriodCloseStatus = (typeof PERIOD_CLOSE_STATUS)[number];

/**
 * One `period_close` row (`REC-003`/`REC-006`, `DEC-027`). `scopeId` is the
 * `location.id` for a `location` scope or the `organization.id` for a `company`
 * scope; `checklist`/`snapshot` are the stored jsonb (`unknown` — the domain
 * builders own their shapes). `lockedBy`/`lockedAt` are the lock pair and
 * `reopenedBy`/`reopenedAt`/`reopenReason` the reopen triple (both all-or-nothing
 * at the database). Dates are `YYYY-MM-DD`, instants ISO.
 */
export interface PeriodCloseRecord {
  readonly id: string;
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: string;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  /** One of `PERIOD_CLOSE_STATUSES`. */
  readonly status: string;
  readonly checklist: unknown;
  readonly snapshot: unknown;
  readonly correctionPolicy: string | null;
  readonly lockedBy: string | null;
  /** `timestamptz`, ISO; null until locked. */
  readonly lockedAt: string | null;
  readonly reopenedBy: string | null;
  /** `timestamptz`, ISO; null until reopened. */
  readonly reopenedAt: string | null;
  readonly reopenReason: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  /** `timestamptz`, ISO; null before any update. */
  readonly updatedAt: string | null;
}

export interface NewPeriodCloseRecord {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: string;
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly periodEnd: string;
  /** One of `PERIOD_CLOSE_STATUSES`. */
  readonly status: string;
  readonly checklist: unknown;
  readonly snapshot: unknown;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/**
 * The mutable fields of a close. `undefined` means "leave as is"; `null` clears
 * an optional field. `scopeType`/`scopeId`/`periodStart`/`periodEnd` are not
 * exposed (immutable after creation, and a locked row is immutable at the
 * database); the lifecycle commands set `status` and the lock/reopen fields
 * through this port.
 */
export interface UpdatePeriodCloseRecord {
  readonly organizationId: string;
  readonly periodCloseId: string;
  /** One of `PERIOD_CLOSE_STATUSES`. */
  readonly status?: string;
  /** Replaces the close-task list. */
  readonly checklist?: unknown;
  /** Replaces the frozen snapshot; an explicit `null` clears it. */
  readonly snapshot?: unknown;
  /** Explicit `null` clears the policy; an omitted field is untouched. */
  readonly correctionPolicy?: string | null;
  readonly lockedBy?: string | null;
  /** `timestamptz`, ISO, or null; set when locked. */
  readonly lockedAt?: string | null;
  readonly reopenedBy?: string | null;
  /** `timestamptz`, ISO, or null; set when reopened. */
  readonly reopenedAt?: string | null;
  readonly reopenReason?: string | null;
  /** The acting actor; recorded as `updated_by`. */
  readonly actorId?: string | null;
}

/** Close filters for the store read. */
export interface PeriodCloseListQuery {
  readonly organizationId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`, exact match. */
  readonly scopeType?: string;
  readonly scopeId?: string;
  /** One of `PERIOD_CLOSE_STATUSES`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `period_start`; `YYYY-MM-DD`. */
  readonly from?: string;
  /** Inclusive upper bound on `period_start`; `YYYY-MM-DD`. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The persistence port for the close/lock slice. One port covers the one table,
 * mirroring the persistence repository module. `lockPeriodCloseForScope` takes
 * the scope row's write lock so concurrent `begin` calls serialise;
 * `findLockedPeriodCloseCoveringDate` answers the `REC-006` "is this date
 * locked?" read.
 */
export interface PeriodCloseStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: PeriodCloseStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createPeriodClose(input: NewPeriodCloseRecord): Promise<PeriodCloseRecord>;
  /** One close by id, organization-scoped (`DEC-061`), or `undefined`. */
  findPeriodClose(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<PeriodCloseRecord | undefined>;
  /**
   * The same id read as `findPeriodClose`, taking the row's write lock
   * (`SELECT … FOR UPDATE`) for the rest of the surrounding transaction so two
   * concurrent `lock`/`reopen` calls serialise instead of both passing the status
   * check and both writing an audit fact.
   */
  lockPeriodCloseById(query: {
    readonly organizationId: string;
    readonly id: string;
  }): Promise<PeriodCloseRecord | undefined>;
  /**
   * One close for a scope and period, organization-scoped (`DEC-061`), or
   * `undefined`.
   */
  findPeriodCloseForScope(query: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly scopeId: string;
    readonly periodStart: string;
  }): Promise<PeriodCloseRecord | undefined>;
  /**
   * The same scope-and-period select as `findPeriodCloseForScope`, taking the
   * row's write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding
   * transaction so concurrent transitions for one scope serialise.
   */
  lockPeriodCloseForScope(query: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly scopeId: string;
    readonly periodStart: string;
  }): Promise<PeriodCloseRecord | undefined>;
  /**
   * The `locked` close whose period contains `at`, organization- and
   * scope-scoped (`DEC-061`), or `undefined`.
   */
  findLockedPeriodCloseCoveringDate(query: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly scopeId: string;
    readonly at: string;
  }): Promise<PeriodCloseRecord | undefined>;
  listPeriodCloses(query: PeriodCloseListQuery): Promise<readonly PeriodCloseRecord[]>;
  /**
   * Applies a patch to one close, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization.
   */
  updatePeriodClose(input: UpdatePeriodCloseRecord): Promise<PeriodCloseRecord | undefined>;
}
