import type { AuthRoleRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    listRoles: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "11111111-1111-4111-8111-111111111111";
const ROLE = "33333333-3333-4333-8333-333333333333";

function role(overrides: Partial<AuthRoleRecord> = {}): AuthRoleRecord {
  return { id: ROLE, code: "owner", name: "Owner", description: null, ...overrides };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.listRoles).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/roles", () => {
  it("lists the organization's role catalogue", async () => {
    vi.mocked(application.listRoles).mockResolvedValue([role()]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      rows: [{ id: ROLE, code: "owner", name: "Owner", description: null }],
    });
    expect(application.listRoles).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG }),
    );
  });

  it.each(["owner", "admin"])("allows %s to read roles", async (roleCode) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([roleCode]));
    expect((await GET()).status).toBe(200);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(application.listRoles).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller without the users role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(application.listRoles).not.toHaveBeenCalled();
  });
});
