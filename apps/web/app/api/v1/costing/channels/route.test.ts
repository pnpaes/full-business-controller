import type { UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostingReadStore: vi.fn(() => ({})),
    listChannels: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const CHANNEL = "11111111-1111-4111-8111-111111111111";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCostingReadStore).mockReturnValue({} as never);
  vi.mocked(application.listChannels).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getDb).mockReturnValue({ db: {} } as never);
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/costing/channels", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(application.listChannels).not.toHaveBeenCalled();
  });

  it("returns 403 for a role with no costing access (front_of_house)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(application.listChannels).not.toHaveBeenCalled();
  });

  it("returns the organization's channels, ordered and org-scoped", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    vi.mocked(application.listChannels).mockResolvedValue([
      {
        id: CHANNEL,
        organizationId: ORG,
        code: "IN_STORE",
        name: "In store",
        isDelivery: false,
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(application.listChannels).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      rows: [
        {
          id: CHANNEL,
          code: "IN_STORE",
          name: "In store",
          isDelivery: false,
        },
      ],
    });
  });
});
