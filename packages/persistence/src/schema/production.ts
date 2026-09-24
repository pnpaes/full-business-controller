import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { item, unit } from "./catalog";
import { auditColumns, enumCheck, orgId, quantity, rate, tstz, uuidPk } from "./columns";
import { stockLot, stockMovement } from "./inventory";
import { location, organization, storageArea } from "./organization";
import { recipeVersion } from "./recipes";
import { PRODUCTION_STATUS } from "./vocabularies";

/*
 * Slice 10 — production planning + batches (`PROD-001`–`005`, `WASTE-002`;
 * `DEC-005`, `DEC-031`, `DEC-034`, `DEC-036`, `DEC-061`).
 *
 * `production_plan`, `production_batch`, `production_batch_input` and
 * `production_batch_output` are deferred in `schemas/phase1_2_draft.sql` (there
 * is no DDL for them); the authority for their columns is
 * `docs/phase0/DATA_DICTIONARY.md` §7. The ledger already carries the
 * `production_consumption`/`production_output` movement types and the
 * `production_batch` `source_type` (no new `stock_movement` column is needed);
 * `0021` extends the `stock_movement_source_guard` trigger to validate the
 * `production_batch` source and adds the deferred
 * `waste_event.production_batch_id` FK.
 *
 * ponytail: slice-10 open points — recorded here, deliberately NOT resolved.
 * The same list is in `docs/runbooks/persistence-migrations.md` ("Known
 * follow-up obligations"). Do not invent a resolution for any of these.
 *
 * (a) There is **no `batch_number`/`code`** on `production_batch` or
 *     `production_plan` in any authority (`DATA_DICTIONARY` §7 lists neither),
 *     so there is no natural key and therefore **no `findOrCreate` idempotency
 *     path** (`repositories/production.ts`), unlike `findOrCreateStockCountLine`.
 * (b) `DEC-036` **partial-portion handling has no column**: an intermediate is
 *     stocked in its base unit with a "standard portion size", but no authority
 *     defines where that portion size lives (a future item/recipe-version
 *     attribute, not a batch column), nor how a partial portion is recorded.
 *     The output lines store base-unit quantities only; do not add a portion
 *     column.
 * (c) **Output cost allocation across multiple outputs is undefined**: a batch
 *     may produce several `production_batch_output` rows (finished/by-product/
 *     waste together), but no authority says how the consumed input cost is
 *     allocated across them. No allocation column is invented.
 * (d) **Planned-vs-actual variance posting vs waste double-count
 *     (`WASTE-002`)**: posting the actual input/output movements on completion
 *     already books consumption/output; recording the same abnormal loss as a
 *     `waste_event` (linked by `waste_event.production_batch_id`) could
 *     double-count it. The posting policy is undecided; the schema only stores
 *     the facts.
 * (e) There is **no WIP / source-draw storage area**: `DEC-005`'s central-vs-
 *     local model and `PROD-002`'s consumption posting do not define which
 *     storage area inputs are drawn from or where WIP is held;
 *     `production_batch` has only a `destination_storage_area_id` (and it stays
 *     nullable, since no authority marks it required).
 * (f) `production_plan` has **no line/quantity table** and **no status
 *     vocabulary authority**: `production_status` in
 *     `schemas/domain-enums.yaml` describes the `production_batch` workflow
 *     (matching `DATA_DICTIONARY` §7's batch statuses), so it is enforced on
 *     `production_batch.status` only; `production_plan.status` is stored
 *     unconstrained (defaulted to the workflow's first state) pending a
 *     Phase-0 decision.
 * (g) There is **no yield-variance tolerance or exception store**
 *     (`PROD-003`): the accepted tolerance and the `data_quality_exception`
 *     table with its remediation workflow are both undefined, so
 *     `production_batch.yield_variance_pct` is stored as a fact with no
 *     tolerance check and no exception rows.
 * (h) The **output-kind vocabulary has no Phase-0 yaml key**: the four values
 *     (`finished`/`intermediate`/`by_product`/`waste`) come from
 *     `DATA_DICTIONARY.md:679` but `schemas/domain-enums.yaml` has no
 *     `production_output_kind` key, so `PRODUCTION_OUTPUT_KIND` below is a
 *     **local, non-exported, provisional** constant used by the check
 *     constraint only. It must become an exported vocabulary once the yaml key
 *     is added; do not edit `schemas/domain-enums.yaml` to back-fill it.
 */
const PRODUCTION_OUTPUT_KIND = ["finished", "intermediate", "by_product", "waste"] as const;

export const productionPlan = pgTable(
  "production_plan",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    productionDate: date("production_date").notNull(),
    // Open point (f): no status vocabulary authority for the plan, so no check.
    status: text("status").notNull().default("planned"),
    ...auditColumns(),
  },
  (t) => [
    index("production_plan_org_location_date_idx").on(
      t.organizationId,
      t.locationId,
      t.productionDate,
    ),
    index("production_plan_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const productionBatch = pgTable(
  "production_batch",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    workstation: text("workstation"),
    // PROD-001: a batch is always planned/completed against a recipe version.
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => recipeVersion.id),
    planId: uuid("plan_id").references(() => productionPlan.id),
    status: text("status").notNull().default("planned"),
    plannedStart: tstz("planned_start"),
    actualStart: tstz("actual_start"),
    actualFinish: tstz("actual_finish"),
    // FK app_user(id) is deferred like audit_event.actor_id (deferred-FK convention).
    operatorId: uuid("operator_id"),
    // Open point (e): no WIP/source-draw storage area exists; the destination
    // stays nullable because no authority marks it required.
    destinationStorageAreaId: uuid("destination_storage_area_id").references(() => storageArea.id),
    plannedOutputQty: quantity("planned_output_qty"),
    actualOutputQty: quantity("actual_output_qty"),
    // Open point (g): stored as a fact; no tolerance check, no exception store.
    yieldVariancePct: rate("yield_variance_pct"),
    // `DEC-124`: the observed labour hours booked against the batch, an
    // additive nullable fact (no backfill). `numeric(9,2)` is the hours
    // convention (`shift_adjustment.adjusted_hours`); no cost is derived here.
    actualLabourHours: numeric("actual_labour_hours", { precision: 9, scale: 2 }),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => productionBatch.id),
    ...auditColumns(),
  },
  (t) => [
    check("production_batch_status_check", enumCheck(t.status, PRODUCTION_STATUS)),
    check(
      "production_batch_planned_output_qty_check",
      sql`${t.plannedOutputQty} is null or ${t.plannedOutputQty} >= 0`,
    ),
    check(
      "production_batch_actual_output_qty_check",
      sql`${t.actualOutputQty} is null or ${t.actualOutputQty} >= 0`,
    ),
    check(
      "production_batch_actual_labour_hours_check",
      sql`${t.actualLabourHours} is null or ${t.actualLabourHours} >= 0`,
    ),
    check(
      "production_batch_actual_range_check",
      sql`${t.actualFinish} is null or ${t.actualStart} is null or ${t.actualFinish} >= ${t.actualStart}`,
    ),
    // The required `(organization_id, location_id, status)` read path.
    index("production_batch_org_location_status_idx").on(t.organizationId, t.locationId, t.status),
    index("production_batch_recipe_version_idx").on(t.recipeVersionId),
    index("production_batch_plan_idx").on(t.planId),
    index("production_batch_operator_idx").on(t.operatorId),
    index("production_batch_destination_storage_area_idx").on(t.destinationStorageAreaId),
    index("production_batch_reversal_idx").on(t.reversalOfId),
  ],
);

export const productionBatchInput = pgTable(
  "production_batch_input",
  {
    id: uuidPk(),
    productionBatchId: uuid("production_batch_id")
      .notNull()
      .references(() => productionBatch.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    plannedQty: quantity("planned_qty").notNull(),
    actualQty: quantity("actual_qty"),
    varianceQty: quantity("variance_qty"),
    lotId: uuid("lot_id").references(() => stockLot.id),
    reasonCode: text("reason_code"),
    movementId: uuid("movement_id").references(() => stockMovement.id),
  },
  (t) => [
    check("production_batch_input_planned_qty_check", sql`${t.plannedQty} >= 0`),
    check(
      "production_batch_input_actual_qty_check",
      sql`${t.actualQty} is null or ${t.actualQty} >= 0`,
    ),
    index("production_batch_input_batch_idx").on(t.productionBatchId),
    index("production_batch_input_item_idx").on(t.itemId),
    index("production_batch_input_lot_idx").on(t.lotId),
    index("production_batch_input_movement_idx").on(t.movementId),
  ],
);

export const productionBatchOutput = pgTable(
  "production_batch_output",
  {
    id: uuidPk(),
    productionBatchId: uuid("production_batch_id")
      .notNull()
      .references(() => productionBatch.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => item.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => unit.id),
    // Open point (h): provisional local vocabulary (no yaml key).
    kind: text("kind").notNull(),
    plannedQty: quantity("planned_qty").notNull(),
    actualQty: quantity("actual_qty"),
    varianceQty: quantity("variance_qty"),
    lotId: uuid("lot_id").references(() => stockLot.id),
    expiryDate: date("expiry_date"),
    movementId: uuid("movement_id").references(() => stockMovement.id),
  },
  (t) => [
    check("production_batch_output_kind_check", enumCheck(t.kind, PRODUCTION_OUTPUT_KIND)),
    check("production_batch_output_planned_qty_check", sql`${t.plannedQty} >= 0`),
    check(
      "production_batch_output_actual_qty_check",
      sql`${t.actualQty} is null or ${t.actualQty} >= 0`,
    ),
    index("production_batch_output_batch_idx").on(t.productionBatchId),
    index("production_batch_output_item_idx").on(t.itemId),
    index("production_batch_output_lot_idx").on(t.lotId),
    index("production_batch_output_movement_idx").on(t.movementId),
  ],
);
