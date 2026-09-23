import type {
  RegisterRecipeVersionAllergenInput,
  RegisterRecipeVersionLineInput,
} from "@aquarela/application";

/**
 * Pure body-shape parsing for the recipe write APIs. It only proves types and
 * shapes — the application commands (`registerRecipe`, `registerRecipeVersion`)
 * remain the authority on domain rules (positive quantities, unit compatibility,
 * state vocabulary, cycles), so their `DomainError`s still map correctly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegisterRecipeBody {
  readonly code: string;
  readonly name: string;
  readonly outputItemId?: string | null;
}

export interface RegisterRecipeVersionBody {
  readonly versionNo: number;
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
  /**
   * The DEC-112 direct-labour mapping: a cost centre + role pair, both nullable
   * and all-or-nothing (the command/database enforce the pairing). The manual
   * `preparationMinutes` on the version is the per-batch direct-labour minutes.
   */
  readonly laborCostCenterId?: string | null;
  readonly laborRoleCode?: string | null;
  readonly lines: readonly RegisterRecipeVersionLineInput[];
  readonly allergens?: readonly RegisterRecipeVersionAllergenInput[];
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty bounded string, or `undefined` when absent/blank/oversized. */
function nonEmptyString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** A bounded string that may be empty, or `undefined` when not a string. */
function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** A UUID string, explicit `null`, or `undefined` when malformed. */
function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/** A non-negative integer, or `undefined` when malformed. */
function nullableNonNegativeInt(value: unknown): number | undefined {
  if (value === null) {
    return undefined;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isoDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Parses the `POST /api/v1/recipes` body. */
export function parseRegisterRecipeBody(
  body: Record<string, unknown> | undefined,
): ParseResult<RegisterRecipeBody> {
  const code = nonEmptyString(body?.code, 64);
  const name = nonEmptyString(body?.name, 200);
  if (code === undefined || name === undefined) {
    return { ok: false };
  }
  if (body !== undefined && "outputItemId" in body) {
    const outputItemId = nullableUuid(body.outputItemId);
    if (outputItemId === undefined) {
      return { ok: false };
    }
    return { ok: true, value: { code, name, outputItemId } };
  }
  return { ok: true, value: { code, name } };
}

function parseLine(raw: unknown): RegisterRecipeVersionLineInput | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const componentKind = nonEmptyString(raw.componentKind, 40);
  const quantity = nonEmptyString(raw.quantity, 64);
  const unitId = nonEmptyString(raw.unitId, 40);
  if (componentKind === undefined || quantity === undefined || unitId === undefined) {
    return undefined;
  }

  const line: {
    componentKind: string;
    quantity: string;
    unitId: string;
    itemId?: string | null;
    subRecipeId?: string | null;
    lossFactor?: string;
    stage?: string | null;
    substitutionGroup?: string | null;
  } = { componentKind, quantity, unitId };

  if ("itemId" in raw) {
    const value = nullableUuid(raw.itemId);
    if (value === undefined) {
      return undefined;
    }
    line.itemId = value;
  }
  if ("subRecipeId" in raw) {
    const value = nullableUuid(raw.subRecipeId);
    if (value === undefined) {
      return undefined;
    }
    line.subRecipeId = value;
  }
  if ("lossFactor" in raw) {
    const value = nonEmptyString(raw.lossFactor, 64);
    if (value === undefined) {
      return undefined;
    }
    line.lossFactor = value;
  }
  if ("stage" in raw) {
    const value = raw.stage === null ? null : boundedString(raw.stage, 200);
    if (value === undefined) {
      return undefined;
    }
    line.stage = value;
  }
  if ("substitutionGroup" in raw) {
    const value = raw.substitutionGroup === null ? null : boundedString(raw.substitutionGroup, 200);
    if (value === undefined) {
      return undefined;
    }
    line.substitutionGroup = value;
  }
  return line;
}

function parseAllergen(raw: unknown): RegisterRecipeVersionAllergenInput | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const allergenId = nullableUuid(raw.allergenId);
  const source = nonEmptyString(raw.source, 40);
  if (allergenId === undefined || allergenId === null || source === undefined) {
    return undefined;
  }
  const declaration: { allergenId: string; source: string; verifiedBy?: string | null } = {
    allergenId,
    source,
  };
  if ("verifiedBy" in raw) {
    const value = nullableUuid(raw.verifiedBy);
    if (value === undefined) {
      return undefined;
    }
    declaration.verifiedBy = value;
  }
  return declaration;
}

/** Parses the `POST /api/v1/recipes/[id]/versions` body. */
export function parseRegisterVersionBody(
  body: Record<string, unknown> | undefined,
): ParseResult<RegisterRecipeVersionBody> {
  if (body === undefined) {
    return { ok: false };
  }
  const versionNo = nullableNonNegativeInt(body.versionNo);
  const plannedInputQty = nonEmptyString(body.plannedInputQty, 64);
  const plannedOutputQty = nonEmptyString(body.plannedOutputQty, 64);
  const approvedUsableOutput = nonEmptyString(body.approvedUsableOutput, 64);
  const effectiveFrom = isoDate(body.effectiveFrom);
  if (
    versionNo === undefined ||
    versionNo < 1 ||
    plannedInputQty === undefined ||
    plannedOutputQty === undefined ||
    approvedUsableOutput === undefined ||
    effectiveFrom === undefined
  ) {
    return { ok: false };
  }

  const rawLines = body.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 200) {
    return { ok: false };
  }
  const lines: RegisterRecipeVersionLineInput[] = [];
  for (const rawLine of rawLines) {
    const line = parseLine(rawLine);
    if (line === undefined) {
      return { ok: false };
    }
    lines.push(line);
  }

  const value: {
    versionNo: number;
    plannedInputQty: string;
    plannedOutputQty: string;
    approvedUsableOutput: string;
    effectiveFrom: Date;
    lines: RegisterRecipeVersionLineInput[];
    state?: string;
    effectiveTo?: Date | null;
    approvedBy?: string | null;
    approvedAt?: Date | null;
    preparationMinutes?: number | null;
    notes?: string | null;
    laborCostCenterId?: string | null;
    laborRoleCode?: string | null;
    allergens?: RegisterRecipeVersionAllergenInput[];
  } = { versionNo, plannedInputQty, plannedOutputQty, approvedUsableOutput, effectiveFrom, lines };

  if ("state" in body) {
    const state = nonEmptyString(body.state, 40);
    if (state === undefined) {
      return { ok: false };
    }
    value.state = state;
  }
  if ("effectiveTo" in body) {
    if (body.effectiveTo === null) {
      value.effectiveTo = null;
    } else {
      const effectiveTo = isoDate(body.effectiveTo);
      if (effectiveTo === undefined) {
        return { ok: false };
      }
      value.effectiveTo = effectiveTo;
    }
  }
  if ("approvedBy" in body) {
    const approvedBy = nullableUuid(body.approvedBy);
    if (approvedBy === undefined) {
      return { ok: false };
    }
    value.approvedBy = approvedBy;
  }
  if ("approvedAt" in body) {
    if (body.approvedAt === null) {
      value.approvedAt = null;
    } else {
      const approvedAt = isoDate(body.approvedAt);
      if (approvedAt === undefined) {
        return { ok: false };
      }
      value.approvedAt = approvedAt;
    }
  }
  if ("preparationMinutes" in body) {
    const minutes = nullableNonNegativeInt(body.preparationMinutes);
    if (body.preparationMinutes !== null && minutes === undefined) {
      return { ok: false };
    }
    value.preparationMinutes = minutes ?? null;
  }
  if ("notes" in body) {
    if (body.notes === null) {
      value.notes = null;
    } else {
      const notes = boundedString(body.notes, 2000);
      if (notes === undefined) {
        return { ok: false };
      }
      value.notes = notes;
    }
  }
  // DEC-112 direct-labour mapping. The values only need their types checked
  // here; the command and the all-or-nothing check own the pairing/vocabulary.
  if ("laborCostCenterId" in body) {
    const laborCostCenterId = nullableUuid(body.laborCostCenterId);
    if (laborCostCenterId === undefined) {
      return { ok: false };
    }
    value.laborCostCenterId = laborCostCenterId;
  }
  if ("laborRoleCode" in body) {
    if (body.laborRoleCode === null) {
      value.laborRoleCode = null;
    } else {
      const laborRoleCode = nonEmptyString(body.laborRoleCode, 40);
      if (laborRoleCode === undefined) {
        return { ok: false };
      }
      value.laborRoleCode = laborRoleCode;
    }
  }
  if ("allergens" in body) {
    const rawAllergens = body.allergens;
    if (!Array.isArray(rawAllergens) || rawAllergens.length > 100) {
      return { ok: false };
    }
    const allergens: RegisterRecipeVersionAllergenInput[] = [];
    for (const rawAllergen of rawAllergens) {
      const declaration = parseAllergen(rawAllergen);
      if (declaration === undefined) {
        return { ok: false };
      }
      allergens.push(declaration);
    }
    value.allergens = allergens;
  }

  return { ok: true, value };
}
