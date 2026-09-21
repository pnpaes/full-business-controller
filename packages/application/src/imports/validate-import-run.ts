import { DomainError, assertImportRunStatusTransition } from "@aquarela/domain";

import { IMPORTS_AUDIT_ACTIONS } from "./actions";
import { IMPORT_DIAGNOSTIC_KEYS, type ImportRowIssue } from "./diagnostics";
import type { ImportStagingRowRecord, ImportStore } from "./types";
import {
  datePartOf,
  isBlank,
  isDecimalString,
  isIsoInstant,
  isPlainObject,
  parseImportValidationRules,
  readText,
  sumMoney,
  type ImportValidationRules,
} from "./validation";

export type { ImportValidationRules } from "./validation";

export interface ValidateImportRunInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly importRunId: string;
  readonly rules?: ImportValidationRules;
}

export interface ValidateImportRunResult {
  readonly importRunId: string;
  readonly status: string;
  readonly rowCount: number;
  readonly validCount: number;
  readonly errorCount: number;
  readonly issues: readonly ImportRowIssue[];
}

const AMOUNT_FIELDS = ["gross_amount", "net_amount", "tax_amount"] as const;

/**
 * The validation rules of a run's resolved `import_profile` (`DEC-081`),
 * parsed fail-closed. A run whose `importProfileId` points at a missing row is
 * a `DomainError`: the FK should make that impossible.
 */
async function resolveProfileRules(
  store: ImportStore,
  organizationId: string,
  importProfileId: string,
): Promise<ImportValidationRules> {
  const profile = await store.findImportProfile({ organizationId, importProfileId });
  if (profile === undefined) {
    throw new DomainError(
      `import profile ${importProfileId} not found for import run in organization ${organizationId}`,
    );
  }
  return parseImportValidationRules(profile.validationRules);
}

/** Row-level validation; returns every issue so diagnostics keep the detail. */
function validateRow(
  row: ImportStagingRowRecord,
  rules: ImportValidationRules,
  periodStart: string,
  periodEnd: string,
): ImportRowIssue[] {
  const issues: ImportRowIssue[] = [];
  const add = (code: string, message: string): void => {
    issues.push({ stagingRowId: row.id, sourceRowNo: row.sourceRowNo, code, message });
  };

  if (!isPlainObject(row.raw) || !isPlainObject(row.normalized)) {
    add("invalid_shape", "raw and normalized must be jsonb objects");
    return issues;
  }

  for (const field of rules.requiredNormalizedFields ?? []) {
    if (isBlank(readText(row.normalized, field))) {
      add("missing_field", `required normalized field is missing: ${field}`);
    }
  }

  const occurredAt = readText(row.normalized, "occurred_at");
  if (occurredAt === null) {
    if (rules.requireOccurredAt === true) {
      add("missing_occurred_at", "occurred_at is required");
    }
  } else if (!isIsoInstant(occurredAt)) {
    add("bad_period", `occurred_at is not an ISO instant: ${occurredAt}`);
  } else {
    const occurredOn = datePartOf(occurredAt);
    if (occurredOn === null || occurredOn < periodStart || occurredOn > periodEnd) {
      add("bad_period", `occurred_at ${occurredAt} is outside the run period`);
    }
  }

  const currency = readText(row.normalized, "currency");
  if (rules.expectedCurrency !== undefined) {
    if (currency === null) {
      if (rules.requireCurrency === true) {
        add("missing_currency", "currency is required");
      }
    } else if (currency !== rules.expectedCurrency) {
      add("currency_mismatch", `currency ${currency} does not match ${rules.expectedCurrency}`);
    }
  }

  const allowedLocations = rules.allowedLocationExternalIds;
  if (allowedLocations !== undefined) {
    const location = readText(row.normalized, "location_external_id");
    if (location !== null && !allowedLocations.includes(location)) {
      add("unknown_location", `location_external_id is not allowed: ${location}`);
    }
  }

  for (const field of AMOUNT_FIELDS) {
    const value = row.normalized[field];
    const missing = value === undefined || value === null || value === "";
    if (missing) {
      // Only `gross_amount` is required: it is the reconciliation total, while
      // net/tax are validated when the profile supplies them.
      if (rules.requireAmounts === true && field === "gross_amount") {
        add("missing_amount", `required amount is missing: ${field}`);
      }
      continue;
    }
    if (!isDecimalString(value)) {
      add("invalid_amount", `${field} is not a decimal string`);
    }
  }

  return issues;
}

/**
 * Validates every staged row and moves the run to `validated` or `needs_review`
 * (`SALE-004`, step 4). Invalid rows are **kept** — they are marked with an
 * `error_code` and detailed in `diagnostics.issues`, never discarded. Only a
 * `parsed` run can be validated: a run that has since been mapped is closed out
 * through dispositions, not by re-validating (re-validation would otherwise
 * mark an unmapped run `validated`).
 *
 * Per-currency `gross_amount` totals are recorded in `diagnostics.totals` for
 * `previewImportRun`. Validation does no tolerance comparison; the residual
 * tolerance is slice 12 (`DEC-026`/`DEC-035`) and since `DEC-072` resolves from
 * the effective-dated `reconciliation_tolerance` config in the reconcile
 * commands, not here.
 *
 * The effective rules are the run's profile rules (`DEC-081`) with the caller's
 * explicit `rules` merged over them field-by-field, so a caller rule always
 * wins for the field it sets.
 */
export async function validateImportRun(
  store: ImportStore,
  input: ValidateImportRunInput,
): Promise<ValidateImportRunResult> {
  return store.withTransaction(async (tx) => {
    const run = await tx.findImportRun({
      organizationId: input.organizationId,
      importRunId: input.importRunId,
    });
    if (run === undefined) {
      throw new DomainError("import run not found in organization");
    }
    if (run.status !== "parsed") {
      throw new DomainError(`import run is not awaiting validation (status ${run.status})`);
    }

    const profileRules =
      run.importProfileId === null
        ? {}
        : await resolveProfileRules(tx, input.organizationId, run.importProfileId);
    const rules: ImportValidationRules = { ...profileRules, ...(input.rules ?? {}) };

    const rows = await tx.listImportStagingRows({
      organizationId: input.organizationId,
      importRunId: run.id,
    });

    const issues: ImportRowIssue[] = [];
    let errorCount = 0;
    for (const row of rows) {
      const rowIssues = validateRow(row, rules, run.periodStart, run.periodEnd);
      issues.push(...rowIssues);
      const firstIssue = rowIssues[0];
      await tx.updateImportStagingRow(row.id, {
        errorCode: firstIssue === undefined ? null : firstIssue.code,
      });
      if (rowIssues.length > 0) {
        errorCount += 1;
      }
    }

    const totals = sumMoney(
      rows.flatMap((row) => {
        const currency = readText(row.normalized, "currency");
        const amount = readText(row.normalized, "gross_amount");
        return currency === null || amount === null || !isDecimalString(amount)
          ? []
          : [{ currency, amount }];
      }),
    );

    const status = errorCount > 0 ? "needs_review" : "validated";
    assertImportRunStatusTransition(run.status, status);

    const diagnostics = {
      ...run.diagnostics,
      [IMPORT_DIAGNOSTIC_KEYS.issues]: issues,
      [IMPORT_DIAGNOSTIC_KEYS.totals]: totals,
    };
    const rowCounts = {
      ...run.rowCounts,
      staged: rows.length,
      valid: rows.length - errorCount,
      error: errorCount,
    };

    const updated = await tx.updateImportRun(run.id, { status, rowCounts, diagnostics });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: IMPORTS_AUDIT_ACTIONS.runValidated,
      entityType: "import_run",
      entityId: run.id,
      after: {
        status: updated.status,
        row_count: rows.length,
        error_count: errorCount,
        issue_count: issues.length,
      },
    });

    return {
      importRunId: run.id,
      status: updated.status,
      rowCount: rows.length,
      validCount: rows.length - errorCount,
      errorCount,
      issues,
    };
  });
}
