import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    revokeRole: vi.fn(),
    listRoles: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(),
}));
vi.mock("../../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../../../../../lib/auth";
import { AuthHttpError } from "../../../../../../../../lib/errors";

import { POST } from "./route";

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const ROLE = "33333333-3333-4333-8333-333333333333";
const LOC = "44444444-4444-4444-8444-444444444444";

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
  vi.mocked(application.revokeRole).mockResolvedValue(undefined);
  vi.mocked(application.listRoles).mockResolvedValue([
    { id: ROLE, code: "owner", name: "Owner", description: null },
  ]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "t",
  } as never);
  userStore({ id: TARGET, organizationId: ORG });
});

describe("POST /api/v1/administration/users/[id]/roles/revoke", () => {
  it("revokes the grant and audits through the command", async () => {
    const response = await POST(request({ roleId: ROLE, locationId: LOC }), context(TARGET));

    expect(response.status).toBe(200);
    expect(application.revokeRole).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        userId: TARGET,
        roleId: ROLE,
        locationId: LOC,
        actorId: USER,
      }),
    );
  });

  it("treats an absent location as the organization-wide grant", async () => {
    await POST(request({ roleId: ROLE }), context(TARGET));
    expect(application.revokeRole).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: null }),
    );
  });

  it("returns 403 for a role outside the users gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["location_manager"]));
    const response = await POST(request({ roleId: ROLE }), context(TARGET));
    expect(response.status).toBe(403);
    expect(application.revokeRole).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(request({ roleId: ROLE }), context(TARGET))).status).toBe(401);
  });

  it("returns 400 for a non-UUID id or a malformed body", async () => {
    expect((await POST(request({ roleId: ROLE }), context("not-a-uuid"))).status).toBe(400);
    expect((await POST(request({}), context(TARGET))).status).toBe(400);
    expect((await POST(request({ roleId: "nope" }), context(TARGET))).status).toBe(400);
    expect(application.revokeRole).not.toHaveBeenCalled();
  });

  it("returns 400 for a role outside the organization's catalogue", async () => {
    vi.mocked(application.listRoles).mockResolvedValue([]);
    const response = await POST(request({ roleId: ROLE }), context(TARGET));
    expect(response.status).toBe(400);
    expect(application.revokeRole).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization user", async () => {
    userStore(undefined);
    expect((await POST(request({ roleId: ROLE }), context(TARGET))).status).toBe(404);

    userStore({ id: TARGET, organizationId: "org-2" });
    expect((await POST(request({ roleId: ROLE }), context(TARGET))).status).toBe(404);
    expect(application.revokeRole).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the command to 400", async () => {
    vi.mocked(application.revokeRole).mockRejectedValue(new DomainError("cannot revoke"));
    const response = await POST(request({ roleId: ROLE }), context(TARGET));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "cannot revoke" });
  });
});
