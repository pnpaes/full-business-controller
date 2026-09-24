import {
  DomainError,
  MONEY_SCALE,
  NotFoundError,
  parseDecimal,
  QUANTITY_SCALE,
} from "@aquarela/domain";

import { RECIPE_AUDIT_ACTIONS } from "./actions";
import type { ListRecipeTestsQuery, RecipeStore, RecipeTestView } from "./types";

/**
 * `DEC-123`: the recipe-trial commands. A trial records what was observed when a
 * version was tried and what adjustment it proposes; it is append-only, so this
 * module never updates a measured value — only `registerRecipeVersion` writes the
 * single nullable forward link.
 */

export interface RecordRecipeTestInput {
  readonly organizationId: string;
  readonly actorId: string;
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

export interface RecordRecipeTestResult {
  readonly recipeTestId: string;
}

export interface ListRecipeTestsInput {
  readonly organizationId: string;
  readonly recipeId?: string;
  readonly recipeVersionId?: string;
}

/** `char(3)` ISO-code shape; the vocabulary is open, so only the shape is checked. */
const CURRENCY = /^[A-Za-z]{3}$/;

/** Trimmed text, or null for absent/blank, so a blank comment is not stored. */
function trimToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Records one recipe trial (`DEC-123`). Validates at the trust boundary:
 * the tried version must resolve to a recipe in the caller's organization
 * (`NotFoundError`, a 404); the batch input must be positive; a supplied output
 * must be positive; duration and cost must be non-negative; text is trimmed and
 * blank text stored as null. The trial's measured values are never updated
 * afterwards — a correction is a new row.
 */
export async function recordRecipeTest(
  store: RecipeStore,
  input: RecordRecipeTestInput,
): Promise<RecordRecipeTestResult> {
  if (Number.isNaN(input.testedAt.getTime())) {
    throw new DomainError("testedAt must be a valid instant");
  }
  if (parseDecimal(input.batchInputQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("batchInputQty must be positive");
  }

  const actualOutputQty = input.actualOutputQty ?? null;
  if (actualOutputQty !== null && parseDecimal(actualOutputQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("actualOutputQty must be positive when provided");
  }

  const actualDurationMinutes = input.actualDurationMinutes ?? null;
  if (
    actualDurationMinutes !== null &&
    (!Number.isInteger(actualDurationMinutes) || actualDurationMinutes < 0)
  ) {
    throw new DomainError("actualDurationMinutes must be a non-negative integer");
  }

  const actualCost = input.actualCost ?? null;
  if (actualCost !== null && parseDecimal(actualCost, MONEY_SCALE) < 0n) {
    throw new DomainError("actualCost must not be negative");
  }

  const rawCurrency = trimToNull(input.currency);
  if (rawCurrency !== null && !CURRENCY.test(rawCurrency)) {
    throw new DomainError("currency must be a three-letter code");
  }
  const currency = rawCurrency === null ? null : rawCurrency.toUpperCase();

  const qualityComments = trimToNull(input.qualityComments);
  const proposedAdjustment = trimToNull(input.proposedAdjustment);

  return store.withTransaction(async (tx) => {
    const version = await tx.findRecipeVersion(input.recipeVersionId);
    if (version === undefined) {
      throw new NotFoundError("recipe version not found in organization");
    }
    const recipe = await tx.findRecipe(version.recipeId);
    if (recipe === undefined || recipe.organizationId !== input.organizationId) {
      // Cross-organization or missing: an unknown resource, not a validation error.
      throw new NotFoundError("recipe version not found in organization");
    }

    const created = await tx.createRecipeTest({
      organizationId: input.organizationId,
      recipeVersionId: input.recipeVersionId,
      testedAt: input.testedAt,
      batchInputQty: input.batchInputQty,
      actualOutputQty,
      actualDurationMinutes,
      actualCost,
      currency,
      qualityComments,
      proposedAdjustment,
      actorId: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECIPE_AUDIT_ACTIONS.recipeTestRecorded,
      entityType: "recipe_test",
      entityId: created.id,
      after: {
        recipe_id: recipe.id,
        recipe_version_id: input.recipeVersionId,
        tested_at: input.testedAt.toISOString(),
        batch_input_qty: input.batchInputQty,
        actual_output_qty: actualOutputQty,
        actual_duration_minutes: actualDurationMinutes,
        actual_cost: actualCost,
        currency,
      },
    });

    return { recipeTestId: created.id };
  });
}

/**
 * The organization's trials, newest tested first, for one recipe or one version
 * (`DEC-123`). At least one scope must be supplied; the store applies the
 * organization filter, so a foreign trial is never returned.
 */
export async function listRecipeTests(
  store: RecipeStore,
  input: ListRecipeTestsInput,
): Promise<readonly RecipeTestView[]> {
  const scope: ListRecipeTestsQuery = {
    organizationId: input.organizationId,
    ...(input.recipeId === undefined ? {} : { recipeId: input.recipeId }),
    ...(input.recipeVersionId === undefined ? {} : { recipeVersionId: input.recipeVersionId }),
  };
  if (scope.recipeId === undefined && scope.recipeVersionId === undefined) {
    throw new DomainError("listRecipeTests requires a recipeId or a recipeVersionId");
  }
  return store.listRecipeTests(scope);
}
