import type { PositionRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    listPositions: vi.fn(),
    registerPosition: vi.fn(),
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

import { requireSession } from "../../../../../lib/auth";
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const POSITION_ID = "77777777-7777-4777-8777-777777777777";

function positionRecord(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: POSITION_ID,
    organizationId: ORG,
    code: "barista",
    name: "Barista",
    activeFrom: "2026-01-01",
    activeTo: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/workforce/positions", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  code: "barista",
  name: "Barista",
  activeFrom: "2026-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.listPositions).mockResolvedValue([]);
  vi.mocked(application.registerPosition).mockResolvedValue(positionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/positions", () => {
  it("lists the organization's positions", async () => {
    vi.mocked(application.listPositions).mockResolvedValue([positionRecord()]);

    const response = await GET(new Request("http://localhost/api/v1/workforce/positions"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 200,
      offset: 0,
      rows: [
        {
          id: POSITION_ID,
          code: "barista",
          name: "Barista",
          activeFrom: "2026-01-01",
          activeTo: null,
          createdAt: "2026-01-01T08:00:00.000Z",
          createdBy: USER,
        },
      ],
    });
  });

  it("passes the active filter through and rejects a malformed one", async () => {
    await GET(new Request("http://localhost/api/v1/workforce/positions?active=false"));
    expect(application.listPositions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, active: false }),
    );

    const bad = await GET(new Request("http://localhost/api/v1/workforce/positions?active=maybe"));
    expect(bad.status).toBe(400);
  });

  it("returns 401 when signed out and 403 for a role outside the read set", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);
    expect((await GET(new Request("http://localhost/api/v1/workforce/positions"))).status).toBe(
      401,
    );

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["cleaner"]));
    expect((await GET(new Request("http://localhost/api/v1/workforce/positions"))).status).toBe(
      403,
    );
  });
});

describe("POST /api/v1/workforce/positions", () => {
  it("registers a position", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerPosition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorId: USER, code: "barista" }),
    );
  });

  it("rejects a malformed body with 400", async () => {
    expect((await POST(postRequest({ ...validBody, activeFrom: undefined }))).status).toBe(400);
    expect((await POST(postRequest({ ...validBody, code: 7 }))).status).toBe(400);
    expect(application.registerPosition).not.toHaveBeenCalled();
  });

  it("maps a duplicate-code DomainError to 400", async () => {
    vi.mocked(application.registerPosition).mockRejectedValue(new DomainError("duplicate"));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
  });

  it("returns 403 for a role outside the write set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["cleaner"]));

    expect((await POST(postRequest(validBody))).status).toBe(403);
    expect(application.registerPosition).not.toHaveBeenCalled();
  });
});
