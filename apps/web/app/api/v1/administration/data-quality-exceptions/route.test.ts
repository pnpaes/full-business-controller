import type { DataQualityExceptionRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDataQualityReadStore: vi.fn(() => ({})),
    listDataQualityExceptions: vi.fn(),
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
const ENTITY = "11111111-1111-4111-8111-111111111111";
const PATH = "/api/v1/administration/data-quality-exceptions";

function exception(
  overrides: Partial<DataQualityExceptionRecord> = {},
): DataQualityExceptionRecord {
  return {
    id: "e-1",
    organizationId: ORG,
    ruleCode: "count_variance",
    severity: "high",
    entityType: "stock_count",
    entityId: ENTITY,
    detectedAt: "2026-09-24T09:00:00.000Z",
    ownerId: null,
    dueDate: null,
    status: "open",
    resolution: null,
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

/** The wire row: `toDataQualityExceptionRow` drops the (implicit) organization id. */
function row(): Record<string, unknown> {
  return {
    id: "e-1",
    ruleCode: "count_variance",
    severity: "high",
    entityType: "stock_count",
    entityId: ENTITY,
    detectedAt: "2026-09-24T09:00:00.000Z",
    ownerId: null,
    dueDate: null,
    status: "open",
    resolution: null,
  };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDataQualityReadStore).mockReturnValue({} as never);
  vi.mocked(application.listDataQualityExceptions).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/data-quality-exceptions", () => {
  it("lists the organization's exceptions with the default page", async () => {
    vi.mocked(application.listDataQualityExceptions).mockResolvedValue([exception()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [row()],
    });
    expect(application.listDataQualityExceptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the status, severity and entity-type filters through", async () => {
    const response = await GET(
      getRequest("?status=open&severity=high&entityType=stock_count&limit=5&offset=1"),
    );

    expect(response.status).toBe(200);
    expect(application.listDataQualityExceptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "open",
        severity: "high",
        entityType: "stock_count",
        limit: 5,
        offset: 1,
      }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "finance", "admin", "analyst"])(
    "allows %s to read exceptions",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      expect((await GET(getRequest())).status).toBe(200);
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listDataQualityExceptions).not.toHaveBeenCalled();
  });

  it.each([[[]], [["kitchen"]], [["purchasing"]]])(
    "returns 403 for a caller without an exception-read role %j",
    async (roles) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access(roles));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listDataQualityExceptions).not.toHaveBeenCalled();
    },
  );

  it.each(["?limit=0", "?limit=201", "?limit=x"])(
    "returns 400 for the malformed query %j",
    async (query) => {
      const response = await GET(getRequest(query));

      expect(response.status).toBe(400);
      expect(application.listDataQualityExceptions).not.toHaveBeenCalled();
    },
  );

  it("maps a DomainError from the read service to 400 with its message", async () => {
    vi.mocked(application.listDataQualityExceptions).mockRejectedValue(new DomainError("bad page"));

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad page" });
  });
});
