import {
  DomainError,
  NotFoundError,
  IMPORT_RUN_BLOCKING_STATUSES,
  RECONCILIATION_BLOCKING_STATUSES,
  assertCloseChecklist,
  buildClosePrerequisites,
  buildCloseSnapshot,
  resolveClosePeriod,
} from "@aquarela/domain";
import type { ClosePeriod, ClosePrerequisites } from "@aquarela/domain";

import { CLOSE_AUDIT_ACTIONS } from "./actions";
import type { PeriodCloseRecord, PeriodCloseScopeType, PeriodCloseStore } from "./types";

export interface BeginPeriodCloseInput {
  readonly organizationId: string;
  readonly actorId: string;
  /** One of `PERIOD_CLOSE_SCOPE_TYPES`. */
  readonly scopeType: string;
  /** The `location.id` (location scope) or `organization.id` (company scope). */
  readonly scopeId: string;
  /** `date`, `YYYY-MM-DD`; the scope's period is derived from it. */
  readonly periodStart: string;
  /** The close-task list; validated by `assertCloseChecklist`. */
  readonly checklist: unknown;
}

/**
 * Evaluates the `DEC-107` close prerequisites for one period, organization-wide:
 * the reconciliations/import runs whose period overlaps the close period, the
 * organization's open data-quality exceptions and the effective tolerances at
 * the period end. Only the reconciliation and import-run blocking counts gate
 * the close; the exception count and tolerance presence are informational.
 */
async function evaluateClosePrerequisites(
  store: PeriodCloseStore,
  input: {
    readonly organizationId: string;
    readonly scopeType: PeriodCloseScopeType;
    readonly period: ClosePeriod;
  },
): Promise<ClosePrerequisites> {
  const { organizationId, period } = input;
  const [reconciliations, importRuns, openExceptions, salesSettlement, supplierInvoice] =
    await Promise.all([
      store.listReconciliationsForPeriod({
        organizationId,
        from: period.periodStart,
        to: period.periodEnd,
      }),
      store.listImportRunsForPeriod({
        organizationId,
        from: period.periodStart,
        to: period.periodEnd,
      }),
      store.countOpenDataQualityExceptions({ organizationId }),
      store.findReconciliationTolerance({
        organizationId,
        kind: "sales_settlement",
        asOf: period.periodEnd,
      }),
      store.findReconciliationTolerance({
        organizationId,
        kind: "supplier_invoice",
        asOf: period.periodEnd,
      }),
    ]);
  return buildClosePrerequisites({
    reconciliationStatuses: reconciliations.map((row) => row.status),
    importRunStatuses: importRuns.map((row) => row.status),
    openExceptions,
    tolerances: {
      sales_settlement: salesSettlement !== undefined,
      supplier_invoice: supplierInvoice !== undefined,
    },
    scopeLimited: input.scopeType === "location",
  });
}

/**
 * The `DEC-107` blocker sentence for a close with at least one blocking source.
 * The status lists are rendered from the domain's exported blocking arrays, so a
 * vocabulary change cannot leave the prose stale.
 */
function describeBlockers(prerequisites: ClosePrerequisites): string | undefined {
  const blockers: string[] = [];
  if (prerequisites.reconciliations.blocking > 0) {
    blockers.push(
      `${prerequisites.reconciliations.blocking} reconciliation(s) unresolved (${RECONCILIATION_BLOCKING_STATUSES.join("/")})`,
    );
  }
  if (prerequisites.importRuns.blocking > 0) {
    blockers.push(
      `${prerequisites.importRuns.blocking} import run(s) not closed (${IMPORT_RUN_BLOCKING_STATUSES.join("/")})`,
    );
  }
  return blockers.length === 0 ? undefined : blockers.join(" and ");
}

/**
 * Begins (or re-begins) the close of one scope and period (`REC-003`, `DEC-027`).
 * The period is derived from `scopeType`/`periodStart` via `resolveClosePeriod`
 * (location ⇒ a single day; company ⇒ the UTC calendar month) and the checklist
 * is validated.
 *
 * Inside one transaction the scope row is locked (`lockPeriodCloseForScope`,
 * `SELECT … FOR UPDATE`), so concurrent begins for one scope serialise. An
 * existing row is handled by its status:
 * - `locked` → a `DomainError` ("period is locked; reopen it first");
 * - `closing` → an **idempotent no-op** returning the existing row, with **no**
 *   audit fact;
 * - `open`/`reopened` → updated to `closing` with the new checklist/snapshot;
 * - no row → created as `closing`.
 *
 * Before any write the `DEC-107` prerequisites are evaluated (organization-wide
 * by period) and the frozen snapshot captures them; a blocking reconciliation
 * (`pending`/`exception`) or import run (any status before fully `posted`) is a
 * `DomainError` and leaves the close untouched — no row and no audit fact. The
 * snapshot is frozen at begin: `lockPeriodClose` does not re-evaluate.
 *
 * Two concurrent begins for a **brand-new** scope both miss the lock read (there
 * is no row to lock), so one INSERT wins the unique and the other fails. That
 * failure aborts the transaction on Postgres, so the winner's row can only be
 * observed from a **fresh** transaction — the recovery re-reads outside the
 * failed `withTransaction`, and only when the failed path actually reached the
 * INSERT. A winner's row is returned as the idempotent no-op (no audit fact); a
 * `locked` winner is surfaced as the same `DomainError` a direct locked begin
 * gives.
 *
 * A create or the reopen→closing update writes one
 * `close.period_close.started` fact; the row and its fact commit or roll back
 * together.
 */
export async function beginPeriodClose(
  store: PeriodCloseStore,
  input: BeginPeriodCloseInput,
): Promise<PeriodCloseRecord> {
  // `resolveClosePeriod` validates the scope and the day, so the cast below is safe.
  const period = resolveClosePeriod(input.scopeType, input.periodStart);
  const scopeType = input.scopeType as PeriodCloseScopeType;
  if (scopeType === "company" && input.scopeId !== input.organizationId) {
    throw new DomainError("company scope scopeId must be the organization id");
  }
  const checklist = assertCloseChecklist(input.checklist);

  // Set only once the brand-new-scope INSERT is dispatched, so the recovery
  // below never mistakes an unrelated transaction failure for a create race.
  let createAttempted = false;

  try {
    return await store.withTransaction(async (tx) => {
      const existing = await tx.lockPeriodCloseForScope({
        organizationId: input.organizationId,
        scopeType,
        scopeId: input.scopeId,
        periodStart: period.periodStart,
      });

      if (existing !== undefined) {
        if (existing.status === "locked") {
          throw new DomainError("period is locked; reopen it first");
        }
        if (existing.status === "closing") {
          // Idempotent: the close is already under way, so nothing changes and no
          // audit fact is written (the payroll `generated` no-op precedent).
          return existing;
        }
      }

      // Evaluate and freeze the prerequisites before any write: a blocking source
      // leaves the close untouched (nothing created, no audit fact).
      const prerequisites = await evaluateClosePrerequisites(tx, {
        organizationId: input.organizationId,
        scopeType,
        period,
      });
      const blockers = describeBlockers(prerequisites);
      if (blockers !== undefined) {
        throw new DomainError(`cannot close ${scopeType} ${period.periodStart}: ${blockers}`);
      }

      const snapshot = buildCloseSnapshot({
        scopeType,
        scopeId: input.scopeId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        capturedAt: new Date().toISOString(),
        checklist,
        prerequisites,
      });

      if (existing !== undefined) {
        const updated = await tx.updatePeriodClose({
          organizationId: input.organizationId,
          periodCloseId: existing.id,
          status: "closing",
          checklist,
          snapshot,
          actorId: input.actorId,
        });
        if (updated === undefined) {
          throw new NotFoundError("period close not found in organization");
        }
        await tx.writeAudit({
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: CLOSE_AUDIT_ACTIONS.periodCloseStarted,
          entityType: "period_close",
          entityId: updated.id,
          before: { status: existing.status },
          after: {
            status: updated.status,
            scope_type: updated.scopeType,
            scope_id: updated.scopeId,
            period_start: updated.periodStart,
            period_end: updated.periodEnd,
          },
        });
        return updated;
      }

      createAttempted = true;
      const created = await tx.createPeriodClose({
        organizationId: input.organizationId,
        scopeType,
        scopeId: input.scopeId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: "closing",
        checklist,
        snapshot,
        createdBy: input.actorId,
      });

      await tx.writeAudit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: CLOSE_AUDIT_ACTIONS.periodCloseStarted,
        entityType: "period_close",
        entityId: created.id,
        after: {
          status: created.status,
          scope_type: created.scopeType,
          scope_id: created.scopeId,
          period_start: created.periodStart,
          period_end: created.periodEnd,
        },
      });

      return created;
    });
  } catch (error) {
    // The recovery must run on a fresh transaction: on Postgres the unique
    // violation aborted the failed one, so an in-transaction re-read would throw
    // "current transaction is aborted" and the loser would never see the winner.
    if (!createAttempted) {
      throw error;
    }
    const raced = await store.findPeriodCloseForScope({
      organizationId: input.organizationId,
      scopeType,
      scopeId: input.scopeId,
      periodStart: period.periodStart,
    });
    if (raced === undefined) {
      throw error;
    }
    if (raced.status === "locked") {
      throw new DomainError("period is locked; reopen it first");
    }
    return raced;
  }
}
