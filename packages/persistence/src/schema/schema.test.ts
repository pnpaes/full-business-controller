// Structural invariants over the Drizzle Phase 1-2 table metadata.
//
// These are database-free assertions: CI has no PostgreSQL, so migration and
// integration verification (DDL round-trip, constraints, triggers) is covered
// separately by the migration review, not here. What this file guards is the
// metadata contract: the exact table set, UUID primary keys, decimal-only
// numerics with approved precision/scale pairs, and `char(3)` currencies.
import { expect, describe, it } from "vitest";
import { getTableColumns, getTableName, is, type ColumnBaseConfig } from "drizzle-orm";
import { PgChar, PgNumeric, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";

import * as schema from "./index";

const tables = Object.values(schema).filter((value) => is(value, PgTable));

/** The 47 in-scope Phase 1-2 tables: the 35 core tables, the slice-3
 * master-data additions (`unit_conversion`, `supplier`, `supplier_item`,
 * `cost_center`), the slice-4 receiving additions (`goods_receipt`,
 * `goods_receipt_line`), the slice-5 allergen additions (`allergen`,
 * `recipe_allergen`) and the slice-6 cost-allocation additions
 * (`operating_cost`, `labor_rate`, `cost_pool`, `allocation_rule`) from
 * `schemas/phase1_2_draft.sql` / `DATA_DICTIONARY`. */
const EXPECTED_TABLES = [
  "addon_applicability",
  "allergen",
  "allocation_rule",
  "app_user",
  "audit_event",
  "auth_session",
  "calculation_snapshot",
  "channel",
  "channel_fee_rule",
  "cost_card",
  "cost_center",
  "cost_observation",
  "cost_pool",
  "data_ownership",
  "exchange_rate",
  "goods_receipt",
  "goods_receipt_line",
  "item",
  "labor_rate",
  "location",
  "operating_cost",
  "organization",
  "outbox_event",
  "password_reset_token",
  "price_scenario",
  "product",
  "product_recipe_assignment",
  "product_variant",
  "recipe",
  "recipe_allergen",
  "recipe_line",
  "recipe_version",
  "role",
  "snapshot_component",
  "stock_balance",
  "stock_lot",
  "stock_movement",
  "storage_area",
  "supplier",
  "supplier_item",
  "supplier_price",
  "tax_rule",
  "unit",
  "unit_conversion",
  "user_location_scope",
  "user_role",
  "user_totp",
];

/** Deferred to later slices: present in `schemas/phase1_2_draft.sql`'s coverage
 * notes (or the draft) but deliberately not in the Phase 1-2 core. Asserting
 * their absence keeps a half-added table from silently passing review. */
const NOT_EXPECTED_TABLES = [
  "integration_source",
  "publish_run",
  "competitor_source",
  "competitor_observation",
  "sales_transaction",
  "sales_line",
  "employee",
  "shift",
  "shift_assignment",
  "shift_adjustment",
  "payroll_report",
  "ai_analysis_run",
  "ai_suggestion",
  // Procurement/receiving companions left to a later slice (DEC-047 needs only
  // the goods receipt; purchasing and reordering stay deferred).
  "purchase_order",
  "purchase_order_line",
  "reorder_policy",
  // The fixed-asset register is deferred; depreciation is entered as an
  // `operating_cost` (`DATA_DICTIONARY` §4 `asset`) until its slice lands.
  "asset",
];

/** New DB-enforced checks added to the generated core DDL (0001). */
const NEW_CHECK_CONSTRAINTS = [
  "recipe_version_approval_check",
  "cost_card_approval_check",
  "calculation_snapshot_tax_rule_snapshot_check",
  "calculation_snapshot_rounding_scales_check",
  "calculation_snapshot_totals_check",
];

const CORE_MIGRATION_SQL = readFileSync(
  new URL("../../drizzle/0001_phase1_core.sql", import.meta.url),
  "utf8",
);

/** Approved numeric precision/scale pairs from `DATA_DICTIONARY.md`. */
const APPROVED_NUMERIC_SCALES = new Set([
  "19,4", // money
  "19,6", // quantity / factor
  "19,10", // rate
  "9,6", // percentage / rate
  "6,4", // percentage
  "9,2", // hours
]);

const numericColumns = (): {
  table: string;
  column: string;
  numeric: PgNumeric<ColumnBaseConfig<"string", "PgNumeric">>;
}[] =>
  tables.flatMap((table) =>
    Object.values(getTableColumns(table)).flatMap((column) =>
      is(column, PgNumeric)
        ? [{ table: getTableName(table), column: column.name, numeric: column }]
        : [],
    ),
  );

describe("phase 1-2 schema metadata", () => {
  it("exposes exactly the in-scope tables", () => {
    const names = tables.map((table) => getTableName(table)).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it("does not expose the deliberately deferred tables", () => {
    const names = new Set<string>(tables.map((table) => getTableName(table)));
    for (const deferred of NOT_EXPECTED_TABLES) {
      expect(names.has(deferred), `${deferred} must stay deferred to a later slice`).toBe(false);
    }
  });

  it("emits the new integrity checks in the generated core migration", () => {
    for (const constraint of NEW_CHECK_CONSTRAINTS) {
      expect(
        CORE_MIGRATION_SQL.includes(`CONSTRAINT "${constraint}"`),
        `${constraint} missing from 0001_phase1_core.sql`,
      ).toBe(true);
    }
  });

  it("gives every table a UUID primary key named id", () => {
    // Exceptions to the surrogate `id` convention, each deliberate:
    // - `user_location_scope`: join table keyed by (user_id, location_id);
    // - `user_totp`: one row per user, keyed by user_id;
    // - `recipe_allergen`: join table keyed by (recipe_version_id, allergen_id).
    const COMPOSITE_PK_TABLES = ["user_location_scope", "recipe_allergen"];
    const NON_ID_PK_TABLES: Record<string, string> = { user_totp: "user_id" };
    const COMPOSITE_PK_COLUMNS: Record<string, string[]> = {
      user_location_scope: ["location_id", "user_id"],
      recipe_allergen: ["allergen_id", "recipe_version_id"],
    };

    for (const table of tables) {
      const name = getTableName(table);
      const columns = getTableColumns(table);
      const { primaryKeys } = getTableConfig(table);

      if (COMPOSITE_PK_TABLES.includes(name)) {
        const composite = primaryKeys[0];
        expect(composite, `${name} must keep its composite primary key`).toBeDefined();
        expect(
          composite?.columns.map((column) => column.name).sort(),
          `${name} primary key columns`,
        ).toEqual(COMPOSITE_PK_COLUMNS[name]);
        for (const column of composite?.columns ?? []) {
          expect(column.columnType, `${name}.${column.name} must be uuid`).toBe("PgUUID");
        }
        continue;
      }

      const pkName = NON_ID_PK_TABLES[name] ?? "id";
      // `getTableColumns` is keyed by the TS property name (e.g. `userId`), so
      // look the column up by its database name instead.
      const id = Object.values(columns).find((column) => column.name === pkName);
      expect(id, `${name} has no ${pkName} column`).toBeDefined();
      expect(id?.columnType, `${name}.${pkName} must be uuid`).toBe("PgUUID");
      expect(id?.primary, `${name}.${pkName} must be the primary key`).toBe(true);
    }
  });

  it("uses only approved numeric precision and scale pairs", () => {
    for (const { table, column, numeric } of numericColumns()) {
      expect(numeric.precision, `${table}.${column} has no precision`).toBeDefined();
      expect(numeric.scale, `${table}.${column} has no scale`).toBeDefined();
      const pair = `${numeric.precision},${numeric.scale}`;
      expect(APPROVED_NUMERIC_SCALES.has(pair), `${table}.${column} uses numeric(${pair})`).toBe(
        true,
      );
    }
  });

  it("declares no floating-point columns", () => {
    for (const { table, column, numeric } of numericColumns()) {
      expect(numeric.dataType, `${table}.${column} is not a decimal string`).toBe("string");
    }
    for (const table of tables) {
      for (const column of Object.values(getTableColumns(table))) {
        expect(
          ["PgDoublePrecision", "PgReal"].includes(column.columnType),
          `${table}.${column.name} is floating point`,
        ).toBe(false);
      }
    }
  });

  it("declares every currency column as char(3)", () => {
    const currencyColumns = tables.flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((column) => /currency/.test(column.name))
        .map((column) => ({ table: getTableName(table), column })),
    );
    // Guards against the filter silently matching nothing (e.g. a rename).
    expect(currencyColumns.length).toBeGreaterThan(0);

    for (const { table, column } of currencyColumns) {
      expect(is(column, PgChar), `${table}.${column.name} must be char`).toBe(true);
      expect((column as PgChar<never>).length, `${table}.${column.name} must be char(3)`).toBe(3);
    }
  });

  it("guards the scale boundaries that a mis-scaled column would break", () => {
    // A money column typed as quantity (19,6) must not silently pass.
    const item = getTableColumns(schema.item);
    const currentCost = item["currentCost"] as PgNumeric<never>;
    expect(`${currentCost.precision},${currentCost.scale}`).toBe("19,4");

    // A quantity column must not be demoted to money (19,4).
    const stockMovement = getTableColumns(schema.stockMovement);
    const quantityDelta = stockMovement["quantityDelta"] as PgNumeric<never>;
    expect(`${quantityDelta.precision},${quantityDelta.scale}`).toBe("19,6");

    // Percentages follow (9,6); hours-style columns would follow (9,2).
    const taxRule = getTableColumns(schema.taxRule);
    const ratePct = taxRule["ratePct"] as PgNumeric<never>;
    expect(`${ratePct.precision},${ratePct.scale}`).toBe("9,6");
  });
});
