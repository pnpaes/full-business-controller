import type { IntegrationSourceRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresIntegrationSourceStore: vi.fn(() => ({})),
    listIntegrationSources: vi.fn(),
    registerIntegrationSource: vi.fn(),
    updateIntegrationSource: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({ getAuthStore: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/api/v1/administration/integrations";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function record(overrides: Partial<IntegrationSourceRecord> = {}): IntegrationSourceRecord {
  return {
    id: SOURCE_ID,
    organizationId: ORG,
    name: "Till",
    systemType: "pos",
    direction: "read",
    allowedOperations: ["read"],
    credentialsOwner: "Ada Lovelace",
    rateLimitNote: null,
    termsStatus: "pending",
    active: true,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function row(): Record<string, unknown> {
  return {
    id: SOURCE_ID,
    name: "Till",
    systemType: "pos",
    direction: "read",
    allowedOperations: ["read"],
    credentialsOwner: "Ada Lovelace",
    rateLimitNote: null,
    termsStatus: "pending",
    active: true,
  };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Till",
  systemType: "pos",
  direction: "read",
  allowedOperations: ["read"],
  credentialsOwner: "Ada Lovelace",
  rateLimitNote: null,
  termsStatus: "pending",
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresIntegrationSourceStore).mockReturnValue({} as never);
  vi.mocked(application.listIntegrationSources).mockResolvedValue([]);
  vi.mocked(application.registerIntegrationSource).mockResolvedValue({
    integrationSourceId: SOURCE_ID,
  });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/administration/integrations", () => {
  it("lists the organization's sources with the default page", async () => {
    vi.mocked(application.listIntegrationSources).mockResolvedValue([record()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [row()],
    });
    expect(application.listIntegrationSources).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the page through", async () => {
    const response = await GET(getRequest("?limit=10&offset=5"));

    expect(response.status).toBe(200);
    expect(application.listIntegrationSources).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 10, offset: 5 }),
    );
  });

  it.each(["owner", "admin"])("allows %s to read the registry", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));
    expect((await GET(getRequest())).status).toBe(200);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listIntegrationSources).not.toHaveBeenCalled();
  });

  it.each([[[]], [["general_manager"]], [["finance"]], [["analyst"]]])(
    "returns 403 for a caller outside the owner/admin gate %j",
    async (roles) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access(roles));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listIntegrationSources).not.toHaveBeenCalled();
    },
  );

  it.each(["?limit=0", "?limit=201", "?offset=-1", "?limit=x"])(
    "returns 400 for the malformed page %j",
    async (query) => {
      const response = await GET(getRequest(query));
      expect(response.status).toBe(400);
      expect(application.listIntegrationSources).not.toHaveBeenCalled();
    },
  );

  it("maps a DomainError from the read service to 400 with its message", async () => {
    vi.mocked(application.listIntegrationSources).mockRejectedValue(new DomainError("bad page"));

    const response = await GET(getRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad page" });
  });
});

describe("POST /api/v1/administration/integrations", () => {
  it("registers the source for the session actor and organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerIntegrationSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        name: "Till",
        systemType: "pos",
        direction: "read",
        allowedOperations: ["read"],
        credentialsOwner: "Ada Lovelace",
        termsStatus: "pending",
        active: true,
      }),
    );
    // An explicit `null` rate-limit note is "no note": the command defaults it to null.
    const input = vi.mocked(application.registerIntegrationSource).mock.calls[0]?.[1];
    expect(input).not.toHaveProperty("rateLimitNote");
    await expect(response.json()).resolves.toEqual({ ok: true, integrationSourceId: SOURCE_ID });
  });

  it("omits optional fields the caller did not send so the command applies its defaults", async () => {
    const response = await POST(
      postRequest({ name: "Till", systemType: "pos", credentialsOwner: "Ada Lovelace" }),
    );

    expect(response.status).toBe(200);
    const input = vi.mocked(application.registerIntegrationSource).mock.calls[0]?.[1];
    expect(input).not.toHaveProperty("direction");
    expect(input).not.toHaveProperty("allowedOperations");
    expect(input).not.toHaveProperty("termsStatus");
    expect(input).not.toHaveProperty("active");
  });

  it("allows a write operation only through the command's approval gate", async () => {
    const response = await POST(
      postRequest({
        ...validBody,
        direction: "write",
        allowedOperations: ["read", "write_price"],
        termsStatus: "approved",
      }),
    );

    expect(response.status).toBe(200);
    expect(application.registerIntegrationSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowedOperations: ["read", "write_price"],
        termsStatus: "approved",
      }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.registerIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the owner/admin gate", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerIntegrationSource).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, name: undefined }],
    [{ ...validBody, name: "   " }],
    [{ ...validBody, systemType: 42 }],
    [{ ...validBody, credentialsOwner: undefined }],
    [{ ...validBody, direction: "" }],
    [{ ...validBody, allowedOperations: "read" }],
    [{ ...validBody, allowedOperations: ["read", 7] }],
    [{ ...validBody, termsStatus: 1 }],
    [{ ...validBody, rateLimitNote: 7 }],
    [{ ...validBody, active: "yes" }],
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));
    expect(response.status).toBe(400);
    expect(application.registerIntegrationSource).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or non-JSON body", async () => {
    const missing = await POST(
      new Request(`http://localhost${PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      }),
    );
    expect(missing.status).toBe(400);
    expect(application.registerIntegrationSource).not.toHaveBeenCalled();
  });

  it("maps a command DomainError (duplicate / DEC-015) to 400 with its message", async () => {
    vi.mocked(application.registerIntegrationSource).mockRejectedValue(
      new DomainError(
        'allowedOperations may include a write operation only when termsStatus is "approved" (DEC-015)',
      ),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'allowedOperations may include a write operation only when termsStatus is "approved" (DEC-015)',
    });
  });
});
