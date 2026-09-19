import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

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
import { organization } from "./organization";
import { DOCUMENT_STATUS, RECIPE_COMPONENT_KIND } from "./vocabularies";

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
