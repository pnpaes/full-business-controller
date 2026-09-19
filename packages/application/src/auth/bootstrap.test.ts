import { randomUUID } from "node:crypto";

import { verifyPassword } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  MIN_BOOTSTRAP_PASSWORD_LENGTH,
  bootstrapFirstOwner,
  planBootstrapFirstOwner,
} from "./bootstrap";
import type {
  BootstrapGrant,
  BootstrapNewOwner,
  BootstrapOrganization,
  BootstrapRole,
  BootstrapStore,
} from "./bootstrap";
import { CHEAP } from "./test-support";
import type { AuditInput } from "./types";

interface FakeUser {
  readonly id: string;
  readonly organizationId: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly username: string | undefined;
  readonly email: string | undefined;
}

/** Minimal in-memory `BootstrapStore` mirroring the persistence adapter. */
class FakeBootstrapStore implements BootstrapStore {
  readonly organizations = new Map<string, BootstrapOrganization>();
  readonly roles = new Map<
    string,
    { id: string; organizationId: string; code: string; name: string }
  >();
  readonly users = new Map<string, FakeUser>();
  readonly grants: BootstrapGrant[] = [];
  readonly audits: AuditInput[] = [];

  async withTransaction<T>(fn: (store: BootstrapStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async findOrganizationByName(legalName: string): Promise<BootstrapOrganization | undefined> {
    const normalized = legalName.trim().toLowerCase();
    return [...this.organizations.values()].find(
      (organization) => organization.legalName.trim().toLowerCase() === normalized,
    );
  }

  async createOrganization(legalName: string): Promise<BootstrapOrganization> {
    const organization = { id: randomUUID(), legalName };
    this.organizations.set(organization.id, organization);
    return organization;
  }

  async hasRoleGrant(organizationId: string, code: string): Promise<boolean> {
    return this.grants.some((grant) => {
      const role = this.roles.get(grant.roleId);
      return role?.organizationId === organizationId && role.code === code;
    });
  }

  async findRoleByCode(organizationId: string, code: string): Promise<BootstrapRole | undefined> {
    const role = [...this.roles.values()].find(
      (candidate) => candidate.organizationId === organizationId && candidate.code === code,
    );
    return role === undefined ? undefined : { id: role.id };
  }

  async createRole(input: {
    readonly organizationId: string;
    readonly code: string;
    readonly name: string;
  }): Promise<BootstrapRole> {
    const role = { id: randomUUID(), ...input };
    this.roles.set(role.id, role);
    return { id: role.id };
  }

  async findUserByIdentifier(
    organizationId: string,
    identifier: string,
  ): Promise<{ id: string } | undefined> {
    const normalized = identifier.trim().toLowerCase();
    const user = [...this.users.values()].find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        [candidate.username, candidate.email].some(
          (value) => value !== undefined && value.toLowerCase() === normalized,
        ),
    );
    return user === undefined ? undefined : { id: user.id };
  }

  async createUser(input: BootstrapNewOwner): Promise<{ id: string }> {
    const id = randomUUID();
    this.users.set(id, {
      id,
      organizationId: input.organizationId,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      username: input.username,
      email: input.email,
    });
    return { id };
  }

  async assignRole(input: BootstrapGrant): Promise<void> {
    this.grants.push(input);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }
}

function setup(): { store: FakeBootstrapStore; deps: { passwordHashOptions: typeof CHEAP } } {
  return { store: new FakeBootstrapStore(), deps: { passwordHashOptions: CHEAP } };
}

describe("bootstrapFirstOwner", () => {
  it("creates the organization, owner user, role grant and audit row", async () => {
    const { store, deps } = setup();
    const result = await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "owner@aquarela.no",
      ownerUsername: "owner",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(store.organizations.get(result.organizationId)?.legalName).toBe("Aquarela Kafé");
    const user = store.users.get(result.userId);
    expect(user?.email).toBe("owner@aquarela.no");
    expect(store.grants).toEqual([
      { userId: result.userId, roleId: result.roleId, locationId: null, grantedBy: null },
    ]);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]?.action).toBe("auth.bootstrap.owner_created");
    expect(result.generatedPassword?.length ?? 0).toBeGreaterThanOrEqual(
      MIN_BOOTSTRAP_PASSWORD_LENGTH,
    );
    expect(await verifyPassword(user!.passwordHash, result.generatedPassword!)).toBe(true);
  });

  it("refuses a second run once an owner exists, without writing", async () => {
    const { store, deps } = setup();
    await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "owner@aquarela.no",
    });
    const auditsBefore = store.audits.length;

    const second = await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "other@aquarela.no",
    });

    expect(second).toEqual({
      ok: false,
      reason: "owner_exists",
      organizationId: expect.any(String),
    });
    expect(store.audits).toHaveLength(auditsBefore);
    expect(store.users).toHaveLength(1);
  });

  it("--force adds another owner and refuses a duplicate identifier", async () => {
    const { store, deps } = setup();
    await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "owner@aquarela.no",
    });

    const forced = await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "second@aquarela.no",
      force: true,
    });
    expect(forced.ok).toBe(true);
    expect(store.users).toHaveLength(2);
    expect(store.organizations).toHaveLength(1);

    const duplicate = await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "second@aquarela.no",
      force: true,
    });
    expect(duplicate).toEqual({
      ok: false,
      reason: "identifier_taken",
      organizationId: expect.any(String),
    });
  });

  it("accepts an operator password without echoing it back", async () => {
    const { store, deps } = setup();
    const password = "correct-horse-battery-staple";
    const result = await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerUsername: "owner",
      password,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.generatedPassword).toBeUndefined();
    expect(await verifyPassword(store.users.get(result.userId)!.passwordHash, password)).toBe(true);
  });

  it("rejects a short operator password and an unknown role code", async () => {
    const { store, deps } = setup();
    expect(
      await bootstrapFirstOwner(store, deps, {
        organizationName: "Aquarela Kafé",
        ownerEmail: "owner@aquarela.no",
        password: "short",
      }),
    ).toEqual({ ok: false, reason: "password_too_short" });

    expect(
      await bootstrapFirstOwner(store, deps, {
        organizationName: "Aquarela Kafé",
        ownerEmail: "owner@aquarela.no",
        roleCode: "superuser",
      }),
    ).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("rejects a missing organization name and a missing identifier", async () => {
    const { store, deps } = setup();
    expect(
      await bootstrapFirstOwner(store, deps, { organizationName: "  ", ownerEmail: "a@b.no" }),
    ).toEqual({ ok: false, reason: "invalid_input" });
    expect(await bootstrapFirstOwner(store, deps, { organizationName: "Aquarela Kafé" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });
});

describe("planBootstrapFirstOwner", () => {
  it("reports what would be created without writing anything", async () => {
    const { store } = setup();

    const result = await planBootstrapFirstOwner(store, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "owner@aquarela.no",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.organization).toEqual({ legalName: "Aquarela Kafé", create: true });
    expect(result.plan.role).toEqual({ code: "owner", create: true });
    expect(result.plan.user).toEqual({
      displayName: "owner",
      email: "owner@aquarela.no",
      generatesPassword: true,
    });
    expect(result.plan.grant).toEqual({ locationId: null, create: true });
    // A dry run must not touch the store at all.
    expect(store.organizations).toHaveLength(0);
    expect(store.roles).toHaveLength(0);
    expect(store.users).toHaveLength(0);
    expect(store.grants).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("reuses an existing organization and role, and mirrors the owner-exists refusal", async () => {
    const { store, deps } = setup();
    await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "owner@aquarela.no",
    });
    const organization = [...store.organizations.values()][0]!;
    const role = [...store.roles.values()][0]!;

    const refused = await planBootstrapFirstOwner(store, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "second@aquarela.no",
    });
    expect(refused).toEqual({
      ok: false,
      reason: "owner_exists",
      organizationId: organization.id,
    });
    expect(store.users).toHaveLength(1);

    const forced = await planBootstrapFirstOwner(store, {
      organizationName: "Aquarela Kafé",
      ownerEmail: "second@aquarela.no",
      force: true,
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) {
      return;
    }
    expect(forced.plan.organization).toEqual({
      legalName: "Aquarela Kafé",
      create: false,
      id: organization.id,
    });
    expect(forced.plan.role).toEqual({ code: "owner", create: false, id: role.id });
    expect(forced.plan.user.email).toBe("second@aquarela.no");
    // Still a preview: the forced run was not applied.
    expect(store.users).toHaveLength(1);
    expect(store.audits).toHaveLength(1);
  });

  it("reports an identifier collision without writing", async () => {
    const { store, deps } = setup();
    await bootstrapFirstOwner(store, deps, {
      organizationName: "Aquarela Kafé",
      ownerUsername: "owner",
    });

    const result = await planBootstrapFirstOwner(store, {
      organizationName: "Aquarela Kafé",
      ownerUsername: "owner",
      force: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "identifier_taken",
      organizationId: expect.any(String),
    });
    expect(store.users).toHaveLength(1);
  });
});
