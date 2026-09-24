import type { MasterUnit, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresMasterDataStore: vi.fn(() => ({})),
    listUnits: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PATH = "/api/v1/administration/units";

function unit(overrides: Partial<MasterUnit> = {}): MasterUnit {
  return { id: "u-1", code: "kg", dimension: "mass", isBase: true, ...overrides };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresMasterDataStore).mockReturnValue({} as never);
  vi.mocked(application.listUnits).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/units", () => {
  it("lists the organization's units with the default page", async () => {
    vi.mocked(application.listUnits).mockResolvedValue([unit()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [{ id: "u-1", code: "kg", dimension: "mass", isBase: true }],
    });
    expect(application.listUnits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the dimension filter and paging through", async () => {
    const response = await GET(getRequest("?dimension=volume&limit=10&offset=5"));

    expect(response.status).toBe(200);
    expect(application.listUnits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, dimension: "volume", limit: 10, offset: 5 }),
    );
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "purchasing",
    "finance",
    "admin",
    "analyst",
  ])("allows %s to read units", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    expect((await GET(getRequest())).status).toBe(200);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listUnits).not.toHaveBeenCalled();
  });

  it.each([[[]], [["front_of_house"]]])(
    "returns 403 for a caller without a unit-read role %j",
    async (roles) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access(roles));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listUnits).not.toHaveBeenCalled();
    },
  );

  it.each(["?dimension=bogus", "?limit=0", "?limit=201", "?offset=-1", "?limit=x"])(
    "returns 400 for the malformed query %j",
    async (query) => {
      const response = await GET(getRequest(query));

      expect(response.status).toBe(400);
      expect(application.listUnits).not.toHaveBeenCalled();
    },
  );

  it("maps a DomainError from the read service to 400 with its message", async () => {
    vi.mocked(application.listUnits).mockRejectedValue(new DomainError("bad page"));

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad page" });
  });
});
