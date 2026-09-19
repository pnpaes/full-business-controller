import {
  areUnitsConvertible,
  assertNoSubRecipeCycles,
  assertRecipeVersionState,
  DomainError,
  parseDecimal,
  QUANTITY_SCALE,
  selectEffectiveRecipeVersion,
  Unit,
  usableYieldRate,
} from "@aquarela/domain";
import { ALLERGEN_SOURCE, RECIPE_COMPONENT_KIND } from "@aquarela/persistence";

import { RECIPE_AUDIT_ACTIONS } from "./actions";
import type { RecipeStore, RecipeUnit } from "./types";

/** `loss_factor` / `yield_rate` are `numeric(9,6)` (DATA_DICTIONARY §3). */
const RATE_SCALE = 6;

const COMPONENT_KINDS: readonly string[] = RECIPE_COMPONENT_KIND;
const ALLERGEN_SOURCES: readonly string[] = ALLERGEN_SOURCE;

export interface RegisterRecipeVersionLineInput {
  readonly componentKind: string;
  readonly itemId?: string | null;
  readonly subRecipeId?: string | null;
  readonly quantity: string;
  readonly unitId: string;
  /** Defaults to 1; in (0,1] (`recipe_line.loss_factor`). */
  readonly lossFactor?: string;
  readonly stage?: string | null;
  readonly substitutionGroup?: string | null;
}

export interface RegisterRecipeVersionAllergenInput {
  readonly allergenId: string;
  readonly source: string;
  /** Required when `source` is `verified` (`recipe_allergen_verified_check`). */
  readonly verifiedBy?: string | null;
}

export interface RegisterRecipeVersionInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly recipeId: string;
  readonly versionNo: number;
  /** Defaults to `draft`. */
  readonly state?: string;
  readonly plannedInputQty: string;
  readonly plannedOutputQty: string;
  readonly approvedUsableOutput: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: Date | null;
  readonly preparationMinutes?: number | null;
  readonly notes?: string | null;
  readonly lines: readonly RegisterRecipeVersionLineInput[];
  readonly allergens?: readonly RegisterRecipeVersionAllergenInput[];
}

export interface RegisterRecipeVersionResult {
  readonly recipeVersionId: string;
  /** The `yield_rate` derived from the two quantities and persisted (§6). */
  readonly yieldRate: string;
  readonly lineCount: number;
  readonly allergenCount: number;
}

interface ValidatedLine {
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly subRecipeId: string | null;
  readonly quantity: string;
  readonly unitId: string;
  readonly lossFactor: string;
  readonly stage: string | null;
  readonly substitutionGroup: string | null;
}

function validateLine(line: RegisterRecipeVersionLineInput): ValidatedLine {
  if (!COMPONENT_KINDS.includes(line.componentKind)) {
    throw new DomainError(`componentKind must be one of ${COMPONENT_KINDS.join(", ")}`);
  }
  const itemId = line.itemId ?? null;
  const subRecipeId = line.subRecipeId ?? null;
  if (line.componentKind === "sub_recipe") {
    if (itemId !== null || subRecipeId === null) {
      throw new DomainError("a sub_recipe line requires subRecipeId and no itemId");
    }
  } else if (itemId === null || subRecipeId !== null) {
    throw new DomainError("an ingredient/packaging line requires itemId and no subRecipeId");
  }
  if (parseDecimal(line.quantity, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("recipe line quantity must be positive");
  }
  const lossFactor = line.lossFactor ?? "1";
  const loss = parseDecimal(lossFactor, RATE_SCALE);
  if (loss <= 0n || loss > 10n ** BigInt(RATE_SCALE)) {
    throw new DomainError("recipe line lossFactor must be in (0,1]");
  }
  return {
    componentKind: line.componentKind,
    itemId,
    subRecipeId,
    quantity: line.quantity,
    unitId: line.unitId,
    lossFactor,
    stage: line.stage ?? null,
    substitutionGroup: line.substitutionGroup ?? null,
  };
}

function toDomainUnit(unit: RecipeUnit): Unit {
  return Unit.from(unit.code, unit.dimension, unit.isBase);
}

/**
 * Registers one recipe version with its lines and allergen declarations in a
 * single transaction, appending an audit row. Validates at the trust boundary
 * (CALCULATION_CONTRACT §6, §12): positive quantities, an in-range derived yield
 * rate, a valid effective window, exactly one component reference per line, unit
 * compatibility, no draft dependency when the version is approved (COST-002), and
 * no self/transitive sub-recipe cycle.
 *
 * `recipe_version.yield_rate` is **derived** from
 * `approved_usable_output / planned_input` (§6) rather than accepted as an input,
 * so the stored rate cannot drift from the quantities the cost formula uses.
 */
export async function registerRecipeVersion(
  store: RecipeStore,
  input: RegisterRecipeVersionInput,
): Promise<RegisterRecipeVersionResult> {
  const state = input.state ?? "draft";
  const approvedBy = input.approvedBy ?? null;
  assertRecipeVersionState(state, approvedBy);

  if (parseDecimal(input.plannedInputQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("plannedInputQty must be positive");
  }
  if (parseDecimal(input.plannedOutputQty, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("plannedOutputQty must be positive");
  }
  const yieldRate = usableYieldRate(input.plannedInputQty, input.approvedUsableOutput);

  const effectiveFrom = input.effectiveFrom;
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }
  if (
    input.preparationMinutes !== undefined &&
    input.preparationMinutes !== null &&
    (!Number.isInteger(input.preparationMinutes) || input.preparationMinutes < 0)
  ) {
    throw new DomainError("preparationMinutes must be a non-negative integer");
  }
  if (!Number.isInteger(input.versionNo) || input.versionNo < 1) {
    throw new DomainError("versionNo must be a positive integer");
  }
  if (input.lines.length === 0) {
    throw new DomainError("a recipe version requires at least one line");
  }

  const lines = input.lines.map(validateLine);

  const allergenInputs = input.allergens ?? [];
  const seenAllergens = new Set<string>();
  for (const declaration of allergenInputs) {
    if (!ALLERGEN_SOURCES.includes(declaration.source)) {
      throw new DomainError(`allergen source must be one of ${ALLERGEN_SOURCES.join(", ")}`);
    }
    if (
      declaration.source === "verified" &&
      (declaration.verifiedBy === undefined || declaration.verifiedBy === null)
    ) {
      throw new DomainError("a verified allergen declaration requires verifiedBy");
    }
    if (seenAllergens.has(declaration.allergenId)) {
      throw new DomainError("an allergen may be declared at most once per recipe version");
    }
    seenAllergens.add(declaration.allergenId);
  }

  const approvedAt =
    state === "approved" ? (input.approvedAt ?? new Date()) : (input.approvedAt ?? null);

  return store.withTransaction(async (tx) => {
    const recipe = await tx.findRecipe(input.recipeId);
    if (recipe === undefined || recipe.organizationId !== input.organizationId) {
      throw new DomainError("recipe not found in organization");
    }

    const existingVersions = await tx.listRecipeVersions(input.recipeId);
    if (existingVersions.some((version) => version.versionNo === input.versionNo)) {
      throw new DomainError("versionNo already exists for this recipe");
    }

    // Resolve each line's target and validate unit compatibility against the
    // component's base unit (the unit its cost is expressed in).
    const resolvedLines: Array<{ line: ValidatedLine; baseUnit: RecipeUnit }> = [];
    for (const line of lines) {
      const unit = await tx.findUnit(line.unitId);
      if (unit === undefined) {
        throw new DomainError("recipe line unit not found");
      }

      let baseUnitId: string;
      if (line.componentKind === "sub_recipe") {
        const subRecipe = await tx.findRecipe(line.subRecipeId!);
        if (subRecipe === undefined || subRecipe.organizationId !== input.organizationId) {
          throw new DomainError("sub-recipe not found in organization");
        }
        if (subRecipe.outputItemId === null) {
          throw new DomainError("a sub-recipe must produce an intermediate item (DEC-030)");
        }
        baseUnitId = (await tx.findItem(subRecipe.outputItemId))?.baseUnitId ?? "";
        if (baseUnitId === "") {
          throw new DomainError("sub-recipe output item not found");
        }
        if (state === "approved") {
          const approved = selectEffectiveRecipeVersion(
            (await tx.listRecipeVersions(subRecipe.id)).filter(
              (version) => version.state === "approved",
            ),
            effectiveFrom,
          );
          if (approved === undefined) {
            throw new DomainError(
              "an approved recipe cannot depend on a sub-recipe without an approved version " +
                "effective at effectiveFrom (COST-002)",
            );
          }
        }
      } else {
        const item = await tx.findItem(line.itemId!);
        if (item === undefined || item.organizationId !== input.organizationId) {
          throw new DomainError("recipe line item not found in organization");
        }
        baseUnitId = item.baseUnitId;
      }

      const baseUnit = await tx.findUnit(baseUnitId);
      if (baseUnit === undefined) {
        throw new DomainError("component base unit not found");
      }
      if (!areUnitsConvertible(toDomainUnit(unit), toDomainUnit(baseUnit))) {
        throw new DomainError(
          `incompatible unit dimensions for recipe line: ${unit.dimension} vs ${baseUnit.dimension}`,
        );
      }
      resolvedLines.push({ line, baseUnit });
    }

    // No self-reference and no transitive cycle (COST-002).
    const existingEdges = await tx.listSubRecipeEdges(input.organizationId);
    const newEdges = lines
      .filter((line) => line.componentKind === "sub_recipe")
      .map((line) => ({ parentRecipeId: input.recipeId, childRecipeId: line.subRecipeId! }));
    assertNoSubRecipeCycles([...existingEdges, ...newEdges]);

    for (const declaration of allergenInputs) {
      const allergen = await tx.findAllergen(declaration.allergenId);
      if (allergen === undefined || allergen.organizationId !== input.organizationId) {
        throw new DomainError("allergen not found in organization");
      }
    }

    const created = await tx.createRecipeVersion({
      recipeId: input.recipeId,
      versionNo: input.versionNo,
      state,
      plannedInputQty: input.plannedInputQty,
      plannedOutputQty: input.plannedOutputQty,
      approvedUsableOutput: input.approvedUsableOutput,
      yieldRate,
      preparationMinutes: input.preparationMinutes ?? null,
      effectiveFrom,
      effectiveTo,
      approvedBy,
      approvedAt,
      notes: input.notes ?? null,
    });

    for (const { line } of resolvedLines) {
      await tx.createRecipeLine({
        recipeVersionId: created.id,
        componentKind: line.componentKind,
        itemId: line.itemId,
        subRecipeId: line.subRecipeId,
        quantity: line.quantity,
        unitId: line.unitId,
        lossFactor: line.lossFactor,
        stage: line.stage,
        substitutionGroup: line.substitutionGroup,
      });
    }

    for (const declaration of allergenInputs) {
      await tx.createRecipeAllergen({
        recipeVersionId: created.id,
        allergenId: declaration.allergenId,
        source: declaration.source,
        verifiedBy: declaration.verifiedBy ?? null,
      });
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECIPE_AUDIT_ACTIONS.versionRegistered,
      entityType: "recipe_version",
      entityId: created.id,
      after: {
        recipe_id: input.recipeId,
        version_no: input.versionNo,
        state,
        yield_rate: yieldRate,
        line_count: lines.length,
        allergen_count: allergenInputs.length,
      },
    });

    return {
      recipeVersionId: created.id,
      yieldRate,
      lineCount: lines.length,
      allergenCount: allergenInputs.length,
    };
  });
}
