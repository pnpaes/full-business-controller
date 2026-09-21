import { isPlainObject, type MoneyTotals } from "./validation";

/**
 * Typed views over `import_run.diagnostics` jsonb. No authority pins the jsonb
 * shape (the persistence slice owns the column, this slice owns the keys it
 * writes), so the readers validate the shape defensively and ignore anything
 * they did not write rather than trusting a cast.
 */
export interface ImportRowIssue {
  readonly stagingRowId: string;
  readonly sourceRowNo: number;
  readonly code: string;
  readonly message: string;
}

/** One `DEC-033` conflict, recorded so a reviewer can resolve it explicitly. */
export interface ImportMappingConflict {
  readonly stagingRowId: string;
  readonly sourceRowNo: number;
  readonly kind: string;
  readonly internalEntityIds: readonly string[];
  readonly externalIds: readonly string[];
}

export const IMPORT_DIAGNOSTIC_KEYS = {
  postingPolicy: "posting_policy",
  issues: "issues",
  conflicts: "conflicts",
  totals: "totals",
} as const;

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

export function readIssues(
  diagnostics: Readonly<Record<string, unknown>>,
): readonly ImportRowIssue[] {
  return asArray(diagnostics[IMPORT_DIAGNOSTIC_KEYS.issues]).flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }
    const stagingRowId = asString(item.stagingRowId);
    const code = asString(item.code);
    if (stagingRowId === null || code === null) {
      return [];
    }
    return [
      {
        stagingRowId,
        sourceRowNo: typeof item.sourceRowNo === "number" ? item.sourceRowNo : 0,
        code,
        message: asString(item.message) ?? "",
      },
    ];
  });
}

export function readConflicts(
  diagnostics: Readonly<Record<string, unknown>>,
): readonly ImportMappingConflict[] {
  return asArray(diagnostics[IMPORT_DIAGNOSTIC_KEYS.conflicts]).flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }
    const stagingRowId = asString(item.stagingRowId);
    const kind = asString(item.kind);
    if (stagingRowId === null || kind === null) {
      return [];
    }
    return [
      {
        stagingRowId,
        sourceRowNo: typeof item.sourceRowNo === "number" ? item.sourceRowNo : 0,
        kind,
        internalEntityIds: asStringArray(item.internalEntityIds),
        externalIds: asStringArray(item.externalIds),
      },
    ];
  });
}

/** The per-currency totals `validateImportRun` recorded, or null when absent. */
export function readTotals(diagnostics: Readonly<Record<string, unknown>>): MoneyTotals | null {
  const totals = diagnostics[IMPORT_DIAGNOSTIC_KEYS.totals];
  if (!isPlainObject(totals)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [currency, value] of Object.entries(totals)) {
    if (typeof value === "string") {
      result[currency] = value;
    }
  }
  return result;
}
