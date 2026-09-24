import type { RecipeTestView } from "@aquarela/application";

/**
 * Pure body/query parsing and the row mapper for the `DEC-123` recipe-test
 * routes. Kept free of Next, DB and I/O imports so it can be unit-tested
 * directly; the route does the reads/writes and the application command remains
 * the authority on domain rules (positivity, non-negativity, text trimming).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export interface RecordRecipeTestBody {
  readonly recipeVersionId: string;
  readonly testedAt: Date;
  readonly batchInputQty: string;
  readonly actualOutputQty?: string | null;
  readonly actualDurationMinutes?: number | null;
  readonly actualCost?: string | null;
  readonly currency?: string | null;
  readonly qualityComments?: string | null;
  readonly proposedAdjustment?: string | null;
}

/** A non-empty bounded string, or `undefined` when absent/blank/oversized. */
function nonEmptyString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** A bounded string that may be empty, or `undefined` when not a string. */
function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** A UUID string, or `undefined` when malformed. */
function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/** A non-negative integer, or `undefined` when malformed. */
function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isoDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Parses the `POST /api/v1/recipes/[id]/tests` body. Only shape is checked:
 * `testedAt`/`batchInputQty` are required, the observed outputs are optional
 * (explicit `null` clears them), and the decimal/positivity rules stay in
 * `recordRecipeTest`.
 */
export function parseRecordRecipeTestBody(
  body: Record<string, unknown> | undefined,
): ParseResult<RecordRecipeTestBody> {
  if (body === undefined) {
    return { ok: false };
  }
  const recipeVersionId = uuid(body.recipeVersionId);
  const testedAt = isoDate(body.testedAt);
  const batchInputQty = nonEmptyString(body.batchInputQty, 64);
  if (recipeVersionId === undefined || testedAt === undefined || batchInputQty === undefined) {
    return { ok: false };
  }

  const value: {
    recipeVersionId: string;
    testedAt: Date;
    batchInputQty: string;
    actualOutputQty?: string | null;
    actualDurationMinutes?: number | null;
    actualCost?: string | null;
    currency?: string | null;
    qualityComments?: string | null;
    proposedAdjustment?: string | null;
  } = { recipeVersionId, testedAt, batchInputQty };

  if ("actualOutputQty" in body) {
    if (body.actualOutputQty === null) {
      value.actualOutputQty = null;
    } else {
      const actualOutputQty = nonEmptyString(body.actualOutputQty, 64);
      if (actualOutputQty === undefined) {
        return { ok: false };
      }
      value.actualOutputQty = actualOutputQty;
    }
  }
  if ("actualDurationMinutes" in body) {
    if (body.actualDurationMinutes === null) {
      value.actualDurationMinutes = null;
    } else {
      const minutes = nonNegativeInt(body.actualDurationMinutes);
      if (minutes === undefined) {
        return { ok: false };
      }
      value.actualDurationMinutes = minutes;
    }
  }
  if ("actualCost" in body) {
    if (body.actualCost === null) {
      value.actualCost = null;
    } else {
      const actualCost = nonEmptyString(body.actualCost, 64);
      if (actualCost === undefined) {
        return { ok: false };
      }
      value.actualCost = actualCost;
    }
  }
  if ("currency" in body) {
    if (body.currency === null) {
      value.currency = null;
    } else {
      const currency = nonEmptyString(body.currency, 8);
      if (currency === undefined) {
        return { ok: false };
      }
      value.currency = currency;
    }
  }
  if ("qualityComments" in body) {
    if (body.qualityComments === null) {
      value.qualityComments = null;
    } else {
      const qualityComments = boundedString(body.qualityComments, 4000);
      if (qualityComments === undefined) {
        return { ok: false };
      }
      value.qualityComments = qualityComments;
    }
  }
  if ("proposedAdjustment" in body) {
    if (body.proposedAdjustment === null) {
      value.proposedAdjustment = null;
    } else {
      const proposedAdjustment = boundedString(body.proposedAdjustment, 4000);
      if (proposedAdjustment === undefined) {
        return { ok: false };
      }
      value.proposedAdjustment = proposedAdjustment;
    }
  }

  return { ok: true, value };
}

export interface RecipeTestListQuery {
  readonly recipeVersionId?: string;
}

export type ParsedRecipeTestListQuery =
  { readonly ok: true; readonly query: RecipeTestListQuery } | { readonly ok: false };

/** Parses the optional `?recipeVersionId=` filter (a UUID) for the trial list. */
export function parseRecipeTestListQuery(searchParams: URLSearchParams): ParsedRecipeTestListQuery {
  const raw = searchParams.get("recipeVersionId");
  if (raw === null) {
    return { ok: true, query: {} };
  }
  const value = raw.trim();
  if (!UUID.test(value)) {
    return { ok: false };
  }
  return { ok: true, query: { recipeVersionId: value } };
}

/**
 * The shared API row for a trial: the trial's own facts plus the tried/resulting
 * version identity. `organizationId` is omitted (the caller is already scoped to
 * one organization) and dates are ISO strings.
 */
export function toRecipeTestRow(test: RecipeTestView): Record<string, unknown> {
  return {
    id: test.id,
    recipeId: test.recipeId,
    recipeVersionId: test.recipeVersionId,
    testedAt: test.testedAt.toISOString(),
    batchInputQty: test.batchInputQty,
    actualOutputQty: test.actualOutputQty,
    actualDurationMinutes: test.actualDurationMinutes,
    actualCost: test.actualCost,
    currency: test.currency,
    qualityComments: test.qualityComments,
    proposedAdjustment: test.proposedAdjustment,
    resultingRecipeVersionId: test.resultingRecipeVersionId,
    testedVersionNo: test.testedVersionNo,
    testedVersionState: test.testedVersionState,
    resultingVersionNo: test.resultingVersionNo,
    resultingVersionState: test.resultingVersionState,
    actorId: test.actorId,
    createdAt: test.createdAt.toISOString(),
  };
}
