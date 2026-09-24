import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresInventoryStore: vi.fn(),
    listLocations: vi.fn(),
    replaceLocationScopes: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(),
}));
vi.mock("../../../../../../../lib/db", () => ({
  getDb: vi.fn(() => ({ db: {} })),
}));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const LOC_A = "44444444-4444-4444-8444-444444444444";
const LOC_B = "55555555-5555-4555-8555-555555555555";
const LOC_MISSING = "66666666-6666-4666-8666-666666666666";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function userStore(user: { id: string; organizationId: string } | undefined): void {
  vi.mocked(getAuthStore).mockReturnValue({
    findUserById: vi.fn(async () => user),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresInventoryStore).mockReturnValue({} as never);
  vi.mocked(application.listLocations).mockResolvedValue([
    { id: LOC_A, organizationId: ORG, code: "OSL", name: "Oslo", kind: "warehouse" },
    { id: LOC_B, organizationId: ORG, code: "BER", name: "Bergen", kind: "warehouse" },
  ]);
  vi.mocked(application.replaceLocationScopes).mockResolvedValue(undefined);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "t",
  } as never);
  userStore({ id: TARGET, organizationId: ORG });
});

describe("POST /api/v1/administration/users/[id]/location-scopes", () => {
  it("replaces the whole scope", async () => {
    const response = await POST(request({ locationIds: [LOC_A, LOC_B, LOC_A] }), context(TARGET));

    expect(response.status).toBe(200);
    expect(application.replaceLocationScopes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        userId: TARGET,
        locationIds: [LOC_A, LOC_B],
        actorId: USER,
      }),
    );
  });

  it("accepts an empty scope (clears it)", async () => {
    const response = await POST(request({ locationIds: [] }), context(TARGET));
    expect(response.status).toBe(200);
    expect(application.replaceLocationScopes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationIds: [] }),
    );
  });

  it("returns 403 for a role outside the users gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));
    const response = await POST(request({ locationIds: [LOC_A] }), context(TARGET));
    expect(response.status).toBe(403);
    expect(application.replaceLocationScopes).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(request({ locationIds: [] }), context(TARGET))).status).toBe(401);
  });

  it("returns 400 for a non-UUID id or a malformed scope body", async () => {
    expect((await POST(request({ locationIds: [LOC_A] }), context("not-a-uuid"))).status).toBe(400);
    expect((await POST(request({}), context(TARGET))).status).toBe(400);
    expect((await POST(request({ locationIds: "nope" }), context(TARGET))).status).toBe(400);
    expect((await POST(request({ locationIds: [LOC_A, "nope"] }), context(TARGET))).status).toBe(
      400,
    );
    expect(application.replaceLocationScopes).not.toHaveBeenCalled();
  });

  it("returns 400 naming an unknown location id instead of reaching the foreign key", async () => {
    const response = await POST(request({ locationIds: [LOC_A, LOC_MISSING] }), context(TARGET));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `Unknown location id: ${LOC_MISSING}`,
    });
    expect(application.replaceLocationScopes).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization user", async () => {
    userStore(undefined);
    expect((await POST(request({ locationIds: [] }), context(TARGET))).status).toBe(404);

    userStore({ id: TARGET, organizationId: "org-2" });
    expect((await POST(request({ locationIds: [] }), context(TARGET))).status).toBe(404);
    expect(application.replaceLocationScopes).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the command to 400", async () => {
    vi.mocked(application.replaceLocationScopes).mockRejectedValue(new DomainError("bad scope"));
    const response = await POST(request({ locationIds: [LOC_A] }), context(TARGET));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad scope" });
  });
});
