import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, unique } from "drizzle-orm/pg-core";

import { ALLOWED_OPERATION } from "./vocabularies";
import { auditColumns, enumCheck, orgId, textArrayLiteral, uuidPk } from "./columns";
import { organization } from "./organization";

/*
 * `INTG-001` / `DEC-137` (`ADR-0011`): the **read-only** integrations registry.
 *
 * One row per external system an organization may exchange data with. The
 * registry records *who owns the credentials*, *what data may move* and *whether
 * the terms are approved* — it does not move any data. Publishing execution
 * (`INTG-002`, `publish_run`) stays deferred on `ADR-0004`; this table is the
 * configuration surface only, and `publish_run` is deliberately still in
 * `NOT_EXPECTED_TABLES`.
 *
 * Read-only is the default and the only enabled posture today: `direction`
 * defaults to `read` and every seeded source is `pending` terms with no write
 * operation. The `DEC-015` invariant is enforced at the database as well as in
 * the application — a source may only carry a write operation once its
 * `terms_status` is `approved`
 * (`integration_source_write_requires_approved_terms_check`), so the withheld
 * per-source approval cannot be bypassed by a direct insert.
 *
 * `credentials_owner` is free text (a named owner per `DEC-015`/I18, no closed
 * vocabulary yet — the `DEC-071` precedent). `(organization_id, name)` is unique
 * (the sibling-register precedent; provisional).
 */

/**
 * The `integration_source` system vocabulary. Kept local (not in
 * `./vocabularies`) because `schemas/domain-enums.yaml` has no matching key and
 * `vocabularies.test.ts` requires every exported vocabulary to be yaml-backed.
 */
export const INTEGRATION_SYSTEM_TYPE = [
  "pos",
  "medusa",
  "sanity",
  "wolt",
  "fiken",
  "other",
] as const;

/** The direction of data flow for a source. Read-only is the default posture. */
export const INTEGRATION_DIRECTION = ["read", "write", "read_write"] as const;

/** Per-source terms approval state (`DEC-015`); a write op requires `approved`. */
export const INTEGRATION_TERMS_STATUS = ["pending", "approved", "rejected"] as const;

/** The write operations the `DEC-015` gate covers; a read is always allowed. */
const WRITE_OPERATIONS = [
  "write_price",
  "write_menu_product",
  "write_stock",
  "write_accounting",
] as const;

const allowedOperationArray = textArrayLiteral(ALLOWED_OPERATION);
const writeOperationArray = textArrayLiteral(WRITE_OPERATIONS);

export const integrationSource = pgTable(
  "integration_source",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    name: text("name").notNull(),
    systemType: text("system_type").notNull(),
    direction: text("direction").notNull().default("read"),
    allowedOperations: text("allowed_operations")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The named credentials owner (`DEC-015`/I18); free text, no vocabulary yet. */
    credentialsOwner: text("credentials_owner").notNull(),
    rateLimitNote: text("rate_limit_note"),
    termsStatus: text("terms_status").notNull().default("pending"),
    active: boolean("active").notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    check("integration_source_system_type_check", enumCheck(t.systemType, INTEGRATION_SYSTEM_TYPE)),
    check("integration_source_direction_check", enumCheck(t.direction, INTEGRATION_DIRECTION)),
    check(
      "integration_source_terms_status_check",
      enumCheck(t.termsStatus, INTEGRATION_TERMS_STATUS),
    ),
    check(
      "integration_source_allowed_operations_check",
      sql`${t.allowedOperations} <@ ${allowedOperationArray}`,
    ),
    // DEC-015: a write operation is only selectable once per-source terms are approved.
    check(
      "integration_source_write_requires_approved_terms_check",
      sql`${t.termsStatus} = 'approved' or not (${t.allowedOperations} && ${writeOperationArray})`,
    ),
    unique("integration_source_organization_id_name_key").on(t.organizationId, t.name),
    index("integration_source_organization_id_idx").on(t.organizationId),
  ],
);
