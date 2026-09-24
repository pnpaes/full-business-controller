import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    enableUser: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(),
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
  vi.mocked(application.enableUser).mockResolvedValue(undefined);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["admin"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "t",
  } as never);
  userStore({ id: TARGET, organizationId: ORG });
});

describe("POST /api/v1/administration/users/[id]/enable", () => {
  it("reactivates the user, passing the reason through", async () => {
    const response = await POST(request({ reason: "returning" }), context(TARGET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      userId: TARGET,
      status: "active",
    });
    expect(application.enableUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        userId: TARGET,
        actorId: USER,
        reason: "returning",
      }),
    );
  });

  it("returns 403 for a role outside the users gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    const response = await POST(request({}), context(TARGET));
    expect(response.status).toBe(403);
    expect(application.enableUser).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));
    expect((await POST(request({}), context(TARGET))).status).toBe(401);
  });

  it("returns 400 for a non-UUID id or a non-string reason", async () => {
    expect((await POST(request({}), context("not-a-uuid"))).status).toBe(400);
    expect((await POST(request({ reason: 3 }), context(TARGET))).status).toBe(400);
    expect(application.enableUser).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-organization user", async () => {
    userStore(undefined);
    expect((await POST(request({}), context(TARGET))).status).toBe(404);

    userStore({ id: TARGET, organizationId: "org-2" });
    expect((await POST(request({}), context(TARGET))).status).toBe(404);
    expect(application.enableUser).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the command to 400", async () => {
    vi.mocked(application.enableUser).mockRejectedValue(new DomainError("already active"));
    const response = await POST(request({}), context(TARGET));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "already active" });
  });
});
