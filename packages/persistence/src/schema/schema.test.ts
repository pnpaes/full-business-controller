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

/** The 88 in-scope Phase 1-2 tables: the 35 core tables, the slice-3
 * master-data additions (`unit_conversion`, `supplier`, `supplier_item`,
 * `cost_center`), the slice-4 receiving additions (`goods_receipt`,
 * `goods_receipt_line`), the slice-5 allergen additions (`allergen`,
 * `recipe_allergen`), the slice-6 cost-allocation additions
 * (`operating_cost`, `labor_rate`, `cost_pool`, `allocation_rule`), the
 * slice-9 counts/transfers/waste additions (`stock_count`, `stock_count_line`,
 * `stock_transfer`, `waste_event`), the slice-10 production additions
 * (`production_plan`, `production_batch`, `production_batch_input`,
 * `production_batch_output`), the slice-11 import-framework additions
 * (`import_run`, `import_staging_row`, `external_mapping`), the slice-12
 * sales/settlement/reconciliation additions (`sales_transaction`, `sales_line`,
 * `settlement`, `reconciliation`), the `DEC-072` `reconciliation_tolerance`
 * config table, the `DEC-064`/`DEC-077` `price_version` table, the `DEC-080`
 * `data_quality_exception` table, the `DEC-081` `import_profile` table, the
 * `DEC-083` `import_disposition` table, the `ADR-0006`/`DEC-085`
 * `file_object` table and the `DEC-089` HMS monitoring slice
 * (`monitoring_point`, `monitoring_reading`), and the `DEC-090`/`DEC-095` HMS
 * incident slice (`hms_incident`, `corrective_action`), the `DEC-091` HMS
 * checklist slice (`checklist_template`, `checklist_run`), the `DEC-092` HMS
 * equipment/maintenance slice (`equipment`, `maintenance_log`) and the `DEC-087`
 * workforce personnel slice (`employee`, `employee_document`), and the `DEC-088`
 * staff document library (`document`, `document_version`,
 * `document_acknowledgement`), the `DEC-094` schema-only workflow platform
 * (`task`, `approval`), the `DEC-037`/`DEC-038` shift-scheduling slice
 * (`shift`, `shift_assignment`) and the `DEC-038` worked-hours correction
 * (`shift_adjustment`), and the `DEC-037`/`WF-005` monthly payroll-input report
 * (`payroll_report`), and the `REC-003`/`REC-006`/`DEC-027` period close/lock
 * slice (`period_close`), from
 * `schemas/phase1_2_draft.sql` / `DATA_DICTIONARY`. */
const EXPECTED_TABLES = [
  "addon_applicability",
  "allergen",
  "allocation_rule",
  "app_user",
  "approval",
  "audit_event",
  "auth_session",
  "calculation_snapshot",
  "channel",
  "channel_fee_rule",
  "checklist_run",
  "checklist_template",
  "corrective_action",
  "cost_card",
  "cost_center",
  "cost_observation",
  "cost_pool",
  "data_ownership",
  "data_quality_exception",
  "document",
  "document_acknowledgement",
  "document_version",
  "employee",
  "employee_document",
  "equipment",
  "exchange_rate",
  "external_mapping",
  "file_object",
  "goods_receipt",
  "goods_receipt_line",
  "hms_incident",
  "import_disposition",
  "import_profile",
  "import_run",
  "import_staging_row",
  "item",
  "labor_rate",
  "location",
  "maintenance_log",
  "monitoring_point",
  "monitoring_reading",
  "operating_cost",
  "organization",
  "outbox_event",
  "password_reset_token",
  "payroll_report",
  "period_close",
  "price_scenario",
  "price_version",
  "production_batch",
  "production_batch_input",
  "production_batch_output",
  "production_plan",
  "product",
  "product_recipe_assignment",
  "product_variant",
  "recipe",
  "recipe_allergen",
  "recipe_line",
  "recipe_version",
  "reconciliation",
  "reconciliation_tolerance",
  "role",
  "sales_line",
  "sales_transaction",
  "settlement",
  "shift",
  "shift_adjustment",
  "shift_assignment",
  "snapshot_component",
  "stock_balance",
  "stock_count",
  "stock_count_line",
  "stock_lot",
  "stock_movement",
  "stock_transfer",
  "storage_area",
  "supplier",
  "supplier_item",
  "supplier_price",
  "task",
  "tax_rule",
  "unit",
  "unit_conversion",
  "user_location_scope",
  "user_role",
  "user_totp",
  "waste_event",
];

/** Deferred to later slices: present in `schemas/phase1_2_draft.sql`'s coverage
 * notes (or the draft) but deliberately not in the Phase 1-2 core. Asserting
 * their absence keeps a half-added table from silently passing review. */
const NOT_EXPECTED_TABLES = [
  "integration_source",
  "publish_run",
  "competitor_source",
  "competitor_observation",
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
  // The `job`/worker/outbox layer is gated on `ADR-0004`, still Proposed, per
  // `DEC-094`; only `task`/`approval` are in the schema-only workflow slice.
  "job",
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

/** The `DEC-083` contract pair: `0034` drops the frozen
 * `import_run.diagnostics.dispositions` key now that the `import_disposition`
 * table is the source of truth; its unjournalled down rebuilds the key from the
 * table without dropping it. */
const CONTRACT_MIGRATION_SQL = readFileSync(
  new URL("../../drizzle/0034_import_disposition_contract.sql", import.meta.url),
  "utf8",
);
const CONTRACT_MIGRATION_DOWN_SQL = readFileSync(
  new URL("../../drizzle/0034_import_disposition_contract_down.sql", import.meta.url),
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

  it("drops the frozen diagnostics.dispositions key in the 0034 contract step", () => {
    expect(CONTRACT_MIGRATION_SQL).toContain("- 'dispositions'");
    expect(CONTRACT_MIGRATION_SQL).toContain("? 'dispositions'");
    // The down rebuilds the key from the table and must not drop it.
    expect(CONTRACT_MIGRATION_DOWN_SQL).toContain("jsonb_set(");
    expect(CONTRACT_MIGRATION_DOWN_SQL).toContain("'{dispositions}'");
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
