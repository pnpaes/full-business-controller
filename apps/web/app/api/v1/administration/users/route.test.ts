import type { AuthUserSummary, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    listUsers: vi.fn(),
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
const PATH = "/api/v1/administration/users";

function summary(overrides: Partial<AuthUserSummary> = {}): AuthUserSummary {
  return {
    id: USER,
    username: "ada",
    email: "ada@example.test",
    displayName: "Ada",
    status: "active",
    totpEnabled: false,
    lastLoginAt: new Date("2026-09-24T09:00:00.000Z"),
    roles: [{ roleId: ROLE, code: "owner", locationId: null }],
    locationIds: [],
    ...overrides,
  };
}

function row(): Record<string, unknown> {
  return {
    id: USER,
    displayName: "Ada",
    username: "ada",
    email: "ada@example.test",
    status: "active",
    totpEnabled: false,
    lastLoginAt: "2026-09-24T09:00:00.000Z",
    roles: [{ roleId: ROLE, code: "owner", locationId: null }],
    locationIds: [],
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.listUsers).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/users", () => {
  it("lists the organization's users with the default page and no credentials", async () => {
    vi.mocked(application.listUsers).mockResolvedValue([summary()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [row()],
    });
    expect(application.listUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the page through", async () => {
    const response = await GET(getRequest("?limit=5&offset=2"));

    expect(response.status).toBe(200);
    expect(application.listUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 5, offset: 2 }),
    );
  });

  it.each(["owner", "admin"])("allows %s to read users", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
    expect((await GET(getRequest())).status).toBe(200);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(application.listUsers).not.toHaveBeenCalled();
  });

  it.each([[[]], [["general_manager"]], [["finance"]]])(
    "returns 403 for a caller without the users role %j",
    async (roles) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access(roles));
      const response = await GET(getRequest());
      expect(response.status).toBe(403);
      expect(application.listUsers).not.toHaveBeenCalled();
    },
  );

  it.each(["?limit=0", "?limit=201", "?offset=-1", "?limit=x"])(
    "returns 400 for the malformed page %j",
    async (query) => {
      const response = await GET(getRequest(query));
      expect(response.status).toBe(400);
      expect(application.listUsers).not.toHaveBeenCalled();
    },
  );

  it("maps a DomainError from the read service to 400 with its message", async () => {
    vi.mocked(application.listUsers).mockRejectedValue(new DomainError("bad page"));
    const response = await GET(getRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad page" });
  });
});
