import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import {
  approvalCheck,
  effectiveRange,
  enumCheck,
  orgId,
  quantity,
  rangeCheck,
  rate,
  tstz,
  uuidPk,
} from "./columns";
import { costCenter, organization } from "./organization";
import { ALLERGEN_SOURCE, DOCUMENT_STATUS, RECIPE_COMPONENT_KIND, ROLE_CODE } from "./vocabularies";

export const recipe = pgTable(
  "recipe",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    outputItemId: uuid("output_item_id").references(() => item.id),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [unique("recipe_organization_id_code_key").on(t.organizationId, t.code)],
);

export const recipeVersion = pgTable(
  "recipe_version",
  {
    id: uuidPk(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id),
    versionNo: integer("version_no").notNull(),
    state: text("state").notNull().default("draft"),
    plannedInputQty: quantity("planned_input_qty").notNull(),
    plannedOutputQty: quantity("planned_output_qty").notNull(),
    approvedUsableOutput: quantity("approved_usable_output").notNull(),
    yieldRate: rate("yield_rate").notNull(),
    preparationMinutes: integer("preparation_minutes"),
    ...effectiveRange(),
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    notes: text("notes"),
    // `DEC-112`: the per-version direct-labour mapping. Both columns are
    // nullable and all-or-nothing (`recipe_version_labor_mapping_check`): a
    // version either names a cost centre + role or carries no labour mapping.
    laborCostCenterId: uuid("labor_cost_center_id").references(() => costCenter.id),
    laborRoleCode: text("labor_role_code"),
  },
  (t) => [
    check("recipe_version_state_check", enumCheck(t.state, DOCUMENT_STATUS)),
    check("recipe_version_planned_input_qty_check", sql`${t.plannedInputQty} > 0`),
    check("recipe_version_planned_output_qty_check", sql`${t.plannedOutputQty} > 0`),
    check("recipe_version_approved_usable_output_check", sql`${t.approvedUsableOutput} > 0`),
    check("recipe_version_yield_rate_check", sql`${t.yieldRate} > 0 and ${t.yieldRate} <= 1`),
    check(
      "recipe_version_preparation_minutes_check",
      sql`${t.preparationMinutes} is null or ${t.preparationMinutes} >= 0`,
    ),
    check("recipe_version_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    check("recipe_version_approval_check", approvalCheck(t.state, t.approvedBy, t.approvedAt)),
    check("recipe_version_labor_role_code_check", enumCheck(t.laborRoleCode, ROLE_CODE)),
    check(
      "recipe_version_labor_mapping_check",
      sql`(${t.laborCostCenterId} is null) = (${t.laborRoleCode} is null)`,
    ),
    index("recipe_version_labor_idx").on(t.laborCostCenterId, t.laborRoleCode),
    unique("recipe_version_recipe_id_version_no_key").on(t.recipeId, t.versionNo),
    // recipe_version_no_overlap (exclusion constraint) is emitted in the raw
    // `invariants` migration: drizzle-kit 0.30 cannot express exclusion constraints.
  ],
);

export const recipeLine = pgTable(
  "recipe_line",
  {
    id: uuidPk(),
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => recipeVersion.id, { onDelete: "cascade" }),
    componentKind: text("component_kind").notNull(),
    itemId: uuid("item_id").references(() => item.id),
    subRecipeId: uuid("sub_recipe_id").references(() => recipe.id),
    quantity: quantity("quantity").notNull(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    lossFactor: rate("loss_factor").notNull().default("1"),
    stage: text("stage"),
    substitutionGroup: text("substitution_group"),
  },
  (t) => [
    check("recipe_line_component_kind_check", enumCheck(t.componentKind, RECIPE_COMPONENT_KIND)),
    check("recipe_line_quantity_check", sql`${t.quantity} > 0`),
    check("recipe_line_loss_factor_check", sql`${t.lossFactor} > 0 and ${t.lossFactor} <= 1`),
    check(
      "recipe_line_component_ref_check",
      sql`(${t.itemId} is not null)::int + (${t.subRecipeId} is not null)::int = 1`,
    ),
    index("recipe_line_version_idx").on(t.recipeVersionId),
  ],
);

/**
 * `allergen` master (`DATA_DICTIONARY` §3): org-scoped code + name, and an
 * `is_derived` flag distinguishing an allergen that is automatically derived
 * (from a source ingredient) from one maintained by hand. Allergens are
 * referenced **per recipe version** by `recipe_allergen`.
 */
export const allergen = pgTable(
  "allergen",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isDerived: boolean("is_derived").notNull().default(false),
  },
  (t) => [unique("allergen_organization_id_code_key").on(t.organizationId, t.code)],
);

/**
 * `recipe_allergen` (`DATA_DICTIONARY` §3): an allergen declared on a specific
 * recipe **version** (the dictionary keys it by `recipe_version_id`, not by
 * `recipe`), with `source` ∈ {derived, verified} and the verifier for a
 * `verified` declaration. `source = 'verified'` requires `verified_by`
 * (`recipe_allergen_verified_check`); `verified_by` stays a plain `uuid` because
 * `app_user` FKs are added per the deferred-FK convention, as with
 * `recipe_version.approved_by`. The composite `(recipe_version_id, allergen_id)`
 * primary key gives one declaration per allergen per version.
 */
export const recipeAllergen = pgTable(
  "recipe_allergen",
  {
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => recipeVersion.id, { onDelete: "cascade" }),
    allergenId: uuid("allergen_id")
      .notNull()
      .references(() => allergen.id),
    source: text("source").notNull(),
    verifiedBy: uuid("verified_by"),
  },
  (t) => [
    primaryKey({ columns: [t.recipeVersionId, t.allergenId] }),
    check("recipe_allergen_source_check", enumCheck(t.source, ALLERGEN_SOURCE)),
    check(
      "recipe_allergen_verified_check",
      sql`${t.source} <> 'verified' or ${t.verifiedBy} is not null`,
    ),
    index("recipe_allergen_allergen_idx").on(t.allergenId),
  ],
);
