import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  auditColumns,
  effectiveRange,
  enumCheck,
  orgId,
  rangeCheck,
  tstz,
  uuidPk,
} from "./columns";
import { organization, location } from "./organization";
import { APP_USER_STATUS, DATA_AREA, ROLE_CODE } from "./vocabularies";
import type { UserStatus } from "./vocabularies";

export const appUser = pgTable(
  "app_user",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    username: text("username"),
    email: text("email"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: tstz("password_changed_at"),
    status: text("status").$type<UserStatus>().notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    lastLoginAt: tstz("last_login_at"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    // app_user_username_key / app_user_email_key (unique on lower(...) with a
    // partial `where ... is not null`) are emitted in the raw `invariants`
    // migration: drizzle-kit 0.30 cannot express an expression + partial
    // unique index cleanly.
    check("app_user_status_check", enumCheck(t.status, APP_USER_STATUS)),
    check("app_user_failed_login_count_check", sql`${t.failedLoginCount} >= 0`),
    check("app_user_identifier_check", sql`${t.username} is not null or ${t.email} is not null`),
  ],
);

export const dataOwnership = pgTable(
  "data_ownership",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    dataArea: text("data_area").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => appUser.id),
    reviewCadence: text("review_cadence"),
    ...effectiveRange(),
    grantedBy: uuid("granted_by").references(() => appUser.id),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
  },
  (t) => [
    check("data_ownership_data_area_check", enumCheck(t.dataArea, DATA_AREA)),
    check("data_ownership_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    index("data_ownership_org_area_idx").on(t.organizationId, t.dataArea),
  ],
);

export const role = pgTable(
  "role",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [
    check("role_code_check", enumCheck(t.code, ROLE_CODE)),
    unique("role_organization_id_code_key").on(t.organizationId, t.code),
  ],
);

export const userRole = pgTable(
  "user_role",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    locationId: uuid("location_id").references(() => location.id),
    grantedBy: uuid("granted_by").references(() => appUser.id),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
  },
  (t) => [unique("user_role_key").on(t.userId, t.roleId, t.locationId).nullsNotDistinct()],
);

export const userLocationScope = pgTable(
  "user_location_scope",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

export const userTotp = pgTable(
  "user_totp",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUser.id, { onDelete: "cascade" }),
    secretEncrypted: text("secret_encrypted").notNull(),
    confirmedAt: tstz("confirmed_at"),
    lastUsedCounter: integer("last_used_counter"),
    recoveryCodesHash: text("recovery_codes_hash")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    check(
      "user_totp_last_used_counter_check",
      sql`${t.lastUsedCounter} is null or ${t.lastUsedCounter} >= 0`,
    ),
  ],
);

export const authSession = pgTable(
  "auth_session",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: tstz("issued_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
    userAgent: text("user_agent"),
    ip: inet("ip"),
  },
  (t) => [
    check("auth_session_expiry_check", sql`${t.expiresAt} > ${t.issuedAt}`),
    index("auth_session_user_idx")
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const passwordResetToken = pgTable("password_reset_token", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUser.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: tstz("expires_at").notNull(),
  usedAt: tstz("used_at"),
  createdBy: uuid("created_by").references(() => appUser.id),
  createdAt: tstz("created_at").notNull().defaultNow(),
});
