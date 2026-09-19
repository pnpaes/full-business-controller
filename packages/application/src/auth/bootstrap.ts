import { randomBytes } from "node:crypto";

import { hashPassword } from "@aquarela/domain";
import type { Argon2CostOptions } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import { ROLE_CODE } from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import type { AuditInput } from "./types";

/**
 * One-off bootstrap of the first organization and its first `owner` user.
 *
 * Why this exists: every auth command is organization-scoped and
 * `apps/web/lib/organization.ts` pins the install's organization id from
 * `ORGANIZATION_ID`, but nothing created an organization or a user, so the app
 * could not be used at all. This command creates exactly that.
 *
 * Policy note (implementation default, not a decision): creating the first owner
 * here is an accepted implementation default pending the ADR-0003 open item
 * "confirm the admin-assisted password-reset procedure for staff without
 * email". Until that procedure exists, this command (with `force`) is the
 * operator's recovery path if the owner account is unusable.
 *
 * Idempotency: the guard is scoped to the target organization name. A second run
 * against the same organization refuses once an `owner` grant exists, unless
 * `force` is set; a run for a different organization name is unaffected.
 */

/** Refuse an operator-supplied owner password shorter than this. */
export const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

/** Default role granted to the first user; code is in the `ROLE_CODE` vocabulary. */
const DEFAULT_OWNER_ROLE_CODE = "owner";

/** Persistence port the bootstrap command orchestrates. */
export interface BootstrapOrganization {
  readonly id: string;
  readonly legalName: string;
}

export interface BootstrapRole {
  readonly id: string;
}

export interface BootstrapNewOwner {
  readonly organizationId: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly username?: string;
  readonly email?: string;
}

export interface BootstrapGrant {
  readonly userId: string;
  readonly roleId: string;
  readonly locationId: string | null;
  readonly grantedBy: string | null;
}

export interface BootstrapStore {
  /** Transaction boundary; the creation, the grant and the audit row commit together. */
  withTransaction<T>(fn: (store: BootstrapStore) => Promise<T>): Promise<T>;
  findOrganizationByName(legalName: string): Promise<BootstrapOrganization | undefined>;
  createOrganization(legalName: string): Promise<BootstrapOrganization>;
  hasRoleGrant(organizationId: string, code: string): Promise<boolean>;
  findRoleByCode(organizationId: string, code: string): Promise<BootstrapRole | undefined>;
  createRole(input: {
    readonly organizationId: string;
    readonly code: string;
    readonly name: string;
  }): Promise<BootstrapRole>;
  findUserByIdentifier(
    organizationId: string,
    identifier: string,
  ): Promise<{ readonly id: string } | undefined>;
  createUser(input: BootstrapNewOwner): Promise<{ readonly id: string }>;
  assignRole(input: BootstrapGrant): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
}

export interface BootstrapDeps {
  /** Cheap Argon2 cost for tests; absent = the policy cost. */
  readonly passwordHashOptions?: Argon2CostOptions;
}

export interface BootstrapFirstOwnerInput {
  /** Organization display name; reused if it already exists. */
  readonly organizationName: string;
  readonly ownerEmail?: string;
  readonly ownerUsername?: string;
  readonly ownerDisplayName?: string;
  /**
   * Owner password. When absent the command generates one with the CSPRNG and
   * returns it exactly once in the result. Never logged or audited.
   */
  readonly password?: string;
  /** Existing role id to grant; when absent the role is found/created by code. */
  readonly roleId?: string;
  /** Role code to find or create (default `owner`); ignored when `roleId` is set. */
  readonly roleCode?: string;
  /** Display name for a newly created role. */
  readonly roleName?: string;
  /** Optional location scope for the grant; `null`/absent grants org-wide. */
  readonly locationId?: string | null;
  /** Bypass the "an owner already exists" refusal. */
  readonly force?: boolean;
}

export type BootstrapFailure =
  "invalid_input" | "password_too_short" | "owner_exists" | "identifier_taken";

export type BootstrapFirstOwnerResult =
  | {
      readonly ok: true;
      readonly organizationId: string;
      readonly userId: string;
      readonly roleId: string;
      /** Present only when the command generated the password. */
      readonly generatedPassword?: string;
    }
  | {
      readonly ok: false;
      readonly reason: BootstrapFailure;
      readonly organizationId?: string;
    };

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** 192 bits of CSPRNG entropy; URL-safe, safe to paste into a password field. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

/** `technical_owner` → `Technical Owner`. */
function roleDisplayName(code: string): string {
  return code
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Creates the organization (if absent), the first `owner` user and the role
 * grant in one transaction, with one audit row. Returns the generated password
 * exactly once when it generated one; an operator-supplied password is never
 * echoed back.
 */
export async function bootstrapFirstOwner(
  store: BootstrapStore,
  deps: BootstrapDeps,
  input: BootstrapFirstOwnerInput,
): Promise<BootstrapFirstOwnerResult> {
  const organizationName = input.organizationName.trim();
  const email = normalizeOptional(input.ownerEmail);
  const username = normalizeOptional(input.ownerUsername);
  const roleCode = input.roleCode?.trim() ?? DEFAULT_OWNER_ROLE_CODE;

  if (organizationName.length === 0 || (email === undefined && username === undefined)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.roleId === undefined && !(ROLE_CODE as readonly string[]).includes(roleCode)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.password !== undefined && input.password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    return { ok: false, reason: "password_too_short" };
  }

  const displayName =
    normalizeOptional(input.ownerDisplayName) ?? username ?? email?.split("@")[0] ?? "Owner";

  return store.withTransaction(async (tx) => {
    const existingOrganization = await tx.findOrganizationByName(organizationName);
    if (existingOrganization !== undefined) {
      const ownerExists = await tx.hasRoleGrant(existingOrganization.id, roleCode);
      if (ownerExists && input.force !== true) {
        return {
          ok: false,
          reason: "owner_exists",
          organizationId: existingOrganization.id,
        };
      }
    }

    const organization = existingOrganization ?? (await tx.createOrganization(organizationName));

    let roleId = input.roleId;
    if (roleId === undefined) {
      const existingRole = await tx.findRoleByCode(organization.id, roleCode);
      roleId =
        existingRole?.id ??
        (
          await tx.createRole({
            organizationId: organization.id,
            code: roleCode,
            name: normalizeOptional(input.roleName) ?? roleDisplayName(roleCode),
          })
        ).id;
    }

    for (const identifier of [email, username]) {
      if (identifier === undefined) {
        continue;
      }
      const taken = await tx.findUserByIdentifier(organization.id, identifier);
      if (taken !== undefined) {
        return { ok: false, reason: "identifier_taken", organizationId: organization.id };
      }
    }

    const password = input.password ?? generatePassword();
    const created = await tx.createUser({
      organizationId: organization.id,
      displayName,
      passwordHash: await hashPassword(password, deps.passwordHashOptions),
      ...(username === undefined ? {} : { username }),
      ...(email === undefined ? {} : { email }),
    });

    const locationId = input.locationId ?? null;
    await tx.assignRole({ userId: created.id, roleId, locationId, grantedBy: null });

    await tx.writeAudit({
      organizationId: organization.id,
      actorId: null,
      action: AUTH_AUDIT_ACTIONS.bootstrapOwnerCreated,
      entityType: "app_user",
      entityId: created.id,
      after: {
        organizationName,
        roleCode: input.roleId === undefined ? roleCode : null,
        roleId,
        locationId,
        username: username ?? null,
        email: email ?? null,
        forced: input.force === true,
        generatedPassword: input.password === undefined,
      },
    });

    return {
      ok: true,
      organizationId: organization.id,
      userId: created.id,
      roleId,
      ...(input.password === undefined ? { generatedPassword: password } : {}),
    };
  });
}

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * Adapts the persistence bootstrap primitives to the `BootstrapStore` port,
 * mirroring `createPostgresAuthStore`. `withTransaction` binds a new store to the
 * transaction so the command cannot partially apply.
 */
export function createPostgresBootstrapStore(db: Database): BootstrapStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresBootstrapStore(db));
      }
      return db.transaction((tx) => fn(createPostgresBootstrapStore(tx)));
    },
    findOrganizationByName: async (legalName) => {
      const row = await repo.findOrganizationByName(db, legalName);
      return row === undefined ? undefined : { id: row.id, legalName: row.legalName };
    },
    createOrganization: async (legalName) => {
      const row = await repo.createOrganization(db, { legalName });
      return { id: row.id, legalName: row.legalName };
    },
    hasRoleGrant: (organizationId, code) => repo.hasRoleGrant(db, organizationId, code),
    findRoleByCode: async (organizationId, code) => {
      const row = await repo.findRoleByCode(db, organizationId, code);
      return row === undefined ? undefined : { id: row.id };
    },
    createRole: async (input) => {
      const row = await repo.createRole(db, input);
      return { id: row.id };
    },
    findUserByIdentifier: async (organizationId, identifier) => {
      const row = await repo.findUserByIdentifier(db, organizationId, identifier);
      return row === undefined ? undefined : { id: row.id };
    },
    createUser: async (input) => {
      const row = await repo.createUser(db, {
        organizationId: input.organizationId,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        ...(input.username === undefined ? {} : { username: input.username }),
        ...(input.email === undefined ? {} : { email: input.email }),
      });
      return { id: row.id };
    },
    assignRole: async (input) => {
      await repo.assignRole(db, input);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
