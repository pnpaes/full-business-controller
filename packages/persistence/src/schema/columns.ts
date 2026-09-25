// Shared column and constraint helpers for the Phase 1-2 schema.
//
// Reuse these instead of re-typing precision/flags so the money, quantity,
// currency and effective-dating conventions from
// docs/phase0/DATA_DICTIONARY.md and schemas/phase1_2_draft.sql stay uniform.
import { isNull, sql, type SQL } from "drizzle-orm";
import {
  char,
  date,
  integer,
  jsonb,
  numeric,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/** `uuid primary key default gen_random_uuid()`. */
export const uuidPk = () => uuid("id").primaryKey().defaultRandom();

/** `organization_id uuid not null`; callers attach the FK to `organization`. */
export const orgId = () => uuid("organization_id").notNull();

/** `timestamptz` (all schema timestamps are time-zone aware). */
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Money: `numeric(19,4)` (`DATA_DICTIONARY` convention; never float). */
export const money = (name: string) => numeric(name, { precision: 19, scale: 4 });

/** Quantity: `numeric(19,6)` plus a `unit_id` at the call site. */
export const quantity = (name: string) => numeric(name, { precision: 19, scale: 6 });

/** ISO currency: `char(3)`, defaulting to `NOK` like the draft. */
export const currency = (name = "currency") => char(name, { length: 3 }).default("NOK");

/** Rate / ratio: `numeric(9,6)` (tax rates, yields, loss factors). */
export const rate = (name: string) => numeric(name, { precision: 9, scale: 6 });

/** `jsonb not null default '{}'::jsonb`. */
export const jsonObject = (name: string) =>
  jsonb(name)
    .notNull()
    .default(sql`'{}'::jsonb`);

/**
 * Standard mutable-entity audit columns from `DATA_DICTIONARY.md` §0.
 * `created_by` stays a plain uuid in the draft, so it is not FK'd here.
 */
export const auditColumns = () => ({
  createdAt: tstz("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: tstz("updated_at"),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
});

/** Effective-dating pair; pair with a `effective_to > effective_from` check. */
export const effectiveRange = () => ({
  effectiveFrom: tstz("effective_from").notNull(),
  effectiveTo: tstz("effective_to"),
});

/** Date-typed effective-dating pair (DATA_DICTIONARY §4 uses `date` for these). */
export const dateRange = () => ({
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

/**
 * `column in ('a','b',...)` built from a vocabulary array. Values are quoted
 * literals (not bind parameters) because this SQL is rendered into DDL.
 */
export const enumCheck = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.join(
    values.map((value) => sql.raw(`'${value.replace(/'/g, "''")}'`)),
    sql`, `,
  )})`;

/** `<to> is null or <to> > <from>` for effective-dated / active-range pairs. */
export const rangeCheck = (from: AnyPgColumn, to: AnyPgColumn): SQL =>
  sql`${to} is null or ${to} > ${from}`;

/**
 * `<column> is null`. Exported with the other SQL helpers so an application
 * adapter can add a conditional guard to a write without depending on
 * `drizzle-orm` directly (it is not an application dependency).
 */
export const isNullColumn = (column: AnyPgColumn): SQL => isNull(column);

/** Approval state requires both approver and timestamp. */
export const approvalCheck = (
  state: AnyPgColumn,
  approvedBy: AnyPgColumn,
  approvedAt: AnyPgColumn,
): SQL => sql`${state} <> 'approved' or (${approvedBy} is not null and ${approvedAt} is not null)`;
