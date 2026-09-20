import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, jsonObject, orgId, rangeCheck, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { IMPORT_STATUS, MAPPING_STATE } from "./vocabularies";

/*
 * Slice 11 — import framework + external mappings (`SALE-002`, `SALE-004`,
 * `SALE-007`, `SALE-008`; `DEC-025`, `DEC-033`, `DEC-035`, `DEC-041`;
 * `ADR-0008` still **Proposed**, informational here — row 11 is not gated by
 * it, row 12 is).
 *
 * `import_run`, `import_staging` and `external_mapping` are deferred in
 * `schemas/phase1_2_draft.sql` (line 22; there is no DDL for them); the
 * authority for their columns is `docs/phase0/DATA_DICTIONARY.md` §8 and the
 * workflow is `05_WORKFLOWS.md` §5.9. This slice creates **only** these
 * framework/mapping tables: no `sales_transaction`, `sales_line`, `settlement`
 * or `reconciliation` DDL exists here, because the posting step is row 12 and
 * owner-gated on `ADR-0008`.
 *
 * ponytail: slice-11 open points — recorded here, deliberately NOT resolved.
 * The same list is in `docs/runbooks/persistence-migrations.md` ("Known
 * follow-up obligations"). Do not invent a resolution for any of these.
 *
 * (a) There is **no import/mapping profile table**. `import_run.source` and
 *     `import_run.profile_version` are opaque text labels: the profiles are
 *     static configuration in this slice, not rows. No profile DDL is authored.
 * (b) **`file_object` does not exist yet**, so `import_run.file_object_id` is a
 *     plain `uuid` with **no FK** (deferred-FK convention, like
 *     `goods_receipt.evidence_file_id`). The platform slice that models
 *     `file_object` closes it later.
 * (c) The **posting step is row 12 and owner-gated on `ADR-0008`**. These tables
 *     are created now, but no `sales_transaction`/`sales_line`/`settlement`/
 *     `reconciliation` table is created, so
 *     `import_staging_row.linked_sales_line_id` is a plain `uuid` with no FK.
 *     `IMPORT_POSTING_POLICY` is exported for that later step and backs no
 *     check here.
 * (d) **Tolerance configuration (A3) has no table.** Nothing stores the
 *     tolerance that a `reconciliation` row (row 12) would compare against; no
 *     tolerance column or table is invented.
 */

export const importRun = pgTable(
  "import_run",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    // Open point (a): profiles are static config, so `source`/`profile_version`
    // are opaque labels (no profile table exists).
    source: text("source").notNull(),
    profileVersion: text("profile_version").notNull(),
    // Open point (b): `file_object` is not modelled yet, so this is a plain uuid.
    fileObjectId: uuid("file_object_id"),
    // `file_hash` is unique: 05_WORKFLOWS §5.9 step 2 rejects/recognises a
    // duplicate file by hash before it is parsed.
    fileHash: text("file_hash").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("uploaded"),
    rowCounts: jsonObject("row_counts"),
    diagnostics: jsonObject("diagnostics"),
    ...auditColumns(),
  },
  (t) => [
    check("import_run_status_check", enumCheck(t.status, IMPORT_STATUS)),
    check("import_run_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    unique("import_run_file_hash_key").on(t.fileHash),
    index("import_run_org_source_idx").on(t.organizationId, t.source),
    index("import_run_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const importStagingRow = pgTable(
  "import_staging_row",
  {
    id: uuidPk(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRun.id, { onDelete: "cascade" }),
    sourceRowNo: integer("source_row_no").notNull(),
    // `raw` is the parsed source row; `normalized` is the mapped shape. Both are
    // opaque jsonb — no authority pins their shape down.
    raw: jsonObject("raw"),
    normalized: jsonObject("normalized"),
    mappingState: text("mapping_state").notNull().default("unmapped"),
    errorCode: text("error_code"),
    // Open point (c): `sales_line` is row 12 (owner-gated), so this stays a
    // plain uuid with no FK.
    linkedSalesLineId: uuid("linked_sales_line_id"),
    ...auditColumns(),
  },
  (t) => [
    check("import_staging_row_mapping_state_check", enumCheck(t.mappingState, MAPPING_STATE)),
    // `(import_run_id, source_row_no)` is both the required read path and the
    // idempotency key: replaying a parse cannot duplicate a source row.
    unique("import_staging_row_run_row_no_key").on(t.importRunId, t.sourceRowNo),
  ],
);

/**
 * `external_mapping` (`DATA_DICTIONARY` §8, `SALE-002`). `sku` is the preferred
 * match key for sales/item lines, falling back to `external_id` and then name;
 * the unique key is `(source_system, entity_type, external_id, effective_from)`
 * so history is preserved. The `DEC-033` conflict rule (conflicting rows are
 * flagged and blocked for review, resolution creates an approved superseding
 * mapping) is an application concern; the schema only stores the facts.
 *
 * `entity_type`/`internal_entity_type` are unconstrained text: there is no
 * `schemas/domain-enums.yaml` key for them, and no authority enumerates them.
 */
export const externalMapping = pgTable(
  "external_mapping",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    sourceSystem: text("source_system").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    sku: text("sku"),
    internalEntityType: text("internal_entity_type").notNull(),
    // Polymorphic internal target (product variant, channel, tax code, item, …),
    // so this is a plain uuid with no FK.
    internalEntityId: uuid("internal_entity_id").notNull(),
    effectiveFrom: tstz("effective_from").notNull(),
    effectiveTo: tstz("effective_to"),
    ...auditColumns(),
  },
  (t) => [
    check("external_mapping_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    unique("external_mapping_key").on(t.sourceSystem, t.entityType, t.externalId, t.effectiveFrom),
  ],
);
