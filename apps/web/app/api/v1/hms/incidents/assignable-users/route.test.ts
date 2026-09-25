import type { AssignableUser, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresTaskStore: vi.fn(() => ({})),
    listAssignableUsers: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";

import { GET } from "./route";

const USER = "user-1";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresTaskStore).mockReturnValue({} as never);
  vi.mocked(application.listAssignableUsers).mockResolvedValue([
    { id: "user-2", displayName: "Bo", username: "bo" },
  ] satisfies readonly AssignableUser[]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/hms/incidents/assignable-users", () => {
  it("returns the organization's active users reduced to the picker fields", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      users: [{ id: "user-2", displayName: "Bo", username: "bo" }],
    });
    expect(application.listAssignableUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-1" }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(application.listAssignableUsers).not.toHaveBeenCalled();
  });

  it("returns 403 for analyst, which has no incident access", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listAssignableUsers).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller with no role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([]));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listAssignableUsers).not.toHaveBeenCalled();
  });
});
