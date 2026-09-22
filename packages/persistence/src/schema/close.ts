import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { PERIOD_CLOSE_SCOPE_TYPE, PERIOD_CLOSE_STATUS } from "./vocabularies";

/*
 * `REC-003`/`REC-006`, `DEC-027` (row 13a): the close/lock slice's only table.
 * One `period_close` row is one organization-scoped lock scope and period —
 * either a **location/day** close (`scope_type = 'location'`, a single calendar
 * day) or a **company/calendar-month** close (`scope_type = 'company'`, the
 * first-to-last day of a UTC calendar month). `DEC-027` accepts exactly those two
 * granularities; `DATA_DICTIONARY` §8 is the column authority.
 *
 * `(organization_id, ...)` scoping is per `DEC-061`. `scope_id` is a NOT NULL
 * **plain uuid** — the `location.id` for a `location` scope or the
 * `organization.id` for a `company` scope — deliberately not FK'd, because the
 * target table varies by `scope_type` (the `stock_movement.source_id` precedent);
 * the `0058` `period_close_scope_org_guard` trigger keeps a `location` scope in
 * the row's own organization, and `scope_id` is never null so the unique key
 * needs no `NULLS NOT DISTINCT` handling.
 *
 * `status` is checked against the `period_close_status` vocabulary and defaults
 * to `open`; the machine (`closing` → `locked` → `reopened` → `closing`, with
 * `open` unreachable through the API) is documented **provisionally** — see
 * `DEC-105`. `checklist` is the close-task list (a jsonb array of
 * `{key,label,done}` items); `snapshot` is the frozen closure snapshot, null
 * until closure begins. `correction_policy` is the per-row correction policy
 * text (nullable, per the dictionary). `locked_by`/`locked_at` and
 * `reopened_by`/`reopened_at`/`reopen_reason` are nullable plain uuids and
 * instants (the `app_user` FK is deferred repo-wide, the `shift_adjustment.approved_by`
 * precedent), kept all-or-nothing by database checks; the reopen triple is
 * required when `status = 'reopened'`.
 *
 * The **granularity check** enforces the two accepted shapes structurally: a
 * `location` row is a single day (`period_start = period_end`) and a `company`
 * row spans exactly one UTC calendar month (start is the month's first day, end
 * its last). `period_end >= period_start` is kept separately so a malformed
 * company range is reported by the granularity check rather than as an inverted
 * range. `unique (organization_id, scope_type, scope_id, period_start)` is one
 * row per scope and period; a reopen **reuses** the row, so it never collides.
 *
 * The `0058` trigger additionally makes a `locked` row's snapshot, period, scope
 * and status immutable (only `locked` → `reopened` may follow) and blocks
 * deleting a `locked` row — the `REC-006` "locked snapshots immutable" rule.
 */
export const periodClose = pgTable(
  "period_close",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    scopeType: text("scope_type").notNull(),
    /** The `location.id` (location scope) or `organization.id` (company scope). */
    scopeId: uuid("scope_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("open"),
    checklist: jsonb("checklist")
      .notNull()
      .default(sql`'[]'::jsonb`),
    snapshot: jsonb("snapshot"),
    correctionPolicy: text("correction_policy"),
    lockedBy: uuid("locked_by"),
    lockedAt: tstz("locked_at"),
    reopenedBy: uuid("reopened_by"),
    reopenedAt: tstz("reopened_at"),
    reopenReason: text("reopen_reason"),
    ...auditColumns(),
  },
  (t) => [
    check("period_close_status_check", enumCheck(t.status, PERIOD_CLOSE_STATUS)),
    check("period_close_scope_type_check", enumCheck(t.scopeType, PERIOD_CLOSE_SCOPE_TYPE)),
    check("period_close_period_range_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    check(
      "period_close_granularity_check",
      sql`(${t.scopeType} = 'location' and ${t.periodStart} = ${t.periodEnd}) or (${t.scopeType} = 'company' and ${t.periodStart} = date_trunc('month', ${t.periodStart})::date and ${t.periodEnd} = (date_trunc('month', ${t.periodStart}) + interval '1 month' - interval '1 day')::date)`,
    ),
    check(
      "period_close_locked_check",
      sql`(${t.lockedBy} is null and ${t.lockedAt} is null) or (${t.lockedBy} is not null and ${t.lockedAt} is not null)`,
    ),
    check(
      "period_close_reopened_check",
      sql`${t.status} <> 'reopened' or (${t.reopenedBy} is not null and ${t.reopenedAt} is not null and ${t.reopenReason} is not null)`,
    ),
    unique("period_close_org_scope_period_key").on(
      t.organizationId,
      t.scopeType,
      t.scopeId,
      t.periodStart,
    ),
    index("period_close_org_scope_idx").on(t.organizationId, t.scopeType, t.scopeId),
    index("period_close_org_status_idx").on(t.organizationId, t.status),
  ],
);
