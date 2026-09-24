import type { AuditEventRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    listAuditEvents: vi.fn(),
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
const ENTITY = "22222222-2222-4222-8222-222222222222";
const PATH = "/api/v1/administration/audit-events";

function event(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: "ev-1",
    organizationId: ORG,
    actorId: USER,
    impersonationContext: null,
    action: "role_granted",
    entityType: "app_user",
    entityId: ENTITY,
    entityVersion: null,
    before: { roles: [] },
    after: { roles: ["owner"] },
    reason: null,
    requestId: null,
    correlationId: null,
    occurredAt: "2026-09-24T09:00:00.000Z",
    ...overrides,
  };
}

function row(): Record<string, unknown> {
  return {
    id: "ev-1",
    actorId: USER,
    action: "role_granted",
    entityType: "app_user",
    entityId: ENTITY,
    entityVersion: null,
    reason: null,
    requestId: null,
    correlationId: null,
    occurredAt: "2026-09-24T09:00:00.000Z",
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
  vi.mocked(application.listAuditEvents).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/audit-events", () => {
  it("lists the organization's events with the default page and no diffs", async () => {
    vi.mocked(application.listAuditEvents).mockResolvedValue([event()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [row()],
    });
    expect(application.listAuditEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the entity, action, actor and time filters through", async () => {
    const response = await GET(
      getRequest(
        `?entityType=app_user&entityId=${ENTITY}&action=role_granted&actorId=${USER}` +
          "&from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z&limit=5&offset=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(application.listAuditEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        entityType: "app_user",
        entityId: ENTITY,
        action: "role_granted",
        actorId: USER,
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-30T00:00:00.000Z",
        limit: 5,
        offset: 2,
      }),
    );
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to read audit events", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    expect((await GET(getRequest())).status).toBe(200);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listAuditEvents).not.toHaveBeenCalled();
  });

  it.each([[[]], [["finance"]], [["analyst"]], [["location_manager"]]])(
    "returns 403 for a caller without an audit-read role %j",
    async (roles) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access(roles));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listAuditEvents).not.toHaveBeenCalled();
    },
  );

  it.each([
    "?actorId=not-a-uuid",
    "?entityId=not-a-uuid",
    "?from=not-a-date",
    "?limit=0",
    "?limit=201",
  ])("returns 400 for the malformed query %j", async (query) => {
    const response = await GET(getRequest(query));

    expect(response.status).toBe(400);
    expect(application.listAuditEvents).not.toHaveBeenCalled();
  });

  it("maps a DomainError from the read service to 400 with its message", async () => {
    vi.mocked(application.listAuditEvents).mockRejectedValue(new DomainError("bad page"));

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad page" });
  });
});
