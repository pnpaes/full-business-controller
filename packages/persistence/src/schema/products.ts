import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { item } from "./catalog";
import { effectiveRange, enumCheck, money, orgId, rangeCheck, uuidPk } from "./columns";
import { location, organization } from "./organization";
import { recipeVersion } from "./recipes";
import { PRODUCT_KIND } from "./vocabularies";

export const product = pgTable(
  "product",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    productKind: text("product_kind").notNull().default("base"),
    activeFrom: date("active_from")
      .notNull()
      .default(sql`current_date`),
    activeTo: date("active_to"),
  },
  (t) => [
    check("product_product_kind_check", enumCheck(t.productKind, PRODUCT_KIND)),
    check("product_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    unique("product_organization_id_code_key").on(t.organizationId, t.code),
  ],
);

export const productVariant = pgTable(
  "product_variant",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    code: text("code").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    size: text("size"),
    finishedGoodItemId: uuid("finished_good_item_id").references(() => item.id),
    activeFrom: date("active_from")
      .notNull()
      .default(sql`current_date`),
    activeTo: date("active_to"),
  },
  (t) => [
    check("product_variant_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    unique("product_variant_product_id_code_key").on(t.productId, t.code),
    unique("product_variant_organization_id_sku_key").on(t.organizationId, t.sku),
  ],
);

export const addonApplicability = pgTable(
  "addon_applicability",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    addonProductId: uuid("addon_product_id")
      .notNull()
      .references(() => product.id),
    baseProductId: uuid("base_product_id")
      .notNull()
      .references(() => product.id),
    priceEffect: money("price_effect"),
    activeFrom: date("active_from")
      .notNull()
      .default(sql`current_date`),
    activeTo: date("active_to"),
  },
  (t) => [
    check(
      "addon_applicability_distinct_products_check",
      sql`${t.addonProductId} <> ${t.baseProductId}`,
    ),
    check("addon_applicability_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    index("addon_applicability_base_idx").on(t.organizationId, t.baseProductId),
  ],
);

export const productRecipeAssignment = pgTable(
  "product_recipe_assignment",
  {
    id: uuidPk(),
    productVariantId: uuid("product_variant_id")
      .notNull()
      .references(() => productVariant.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      // ponytail: plain FK (no cascade) on purpose: master records referenced by
      // effective-dated assignments are retired, not deleted. If hard deletes are
      // ever wanted, add soft-delete/retirement instead of ON DELETE.
      .references(() => recipeVersion.id),
    ...effectiveRange(),
  },
  (t) => [
    check(
      "product_recipe_assignment_effective_range_check",
      rangeCheck(t.effectiveFrom, t.effectiveTo),
    ),
    // pra_no_overlap (exclusion constraint) is emitted in the raw `invariants`
    // migration: drizzle-kit 0.30 cannot express exclusion constraints.
  ],
);
