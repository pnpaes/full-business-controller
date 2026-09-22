import type { DocumentRecord, UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    listDocuments: vi.fn(),
    createDocument: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../lib/auth";
import { getServerSession } from "../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

function documentRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: DOCUMENT_ID,
    organizationId: ORG,
    title: "Opening procedure",
    category: "routine",
    audience: "all_staff",
    status: "published",
    ownerId: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/v1/documents${query}`);
}

function postRequest(body: unknown, sameOrigin = true): Request {
  return new Request("http://localhost/api/v1/documents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validBody = { title: "Opening procedure", category: "routine", audience: "all_staff" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.listDocuments).mockResolvedValue([]);
  vi.mocked(application.createDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/documents", () => {
  it("lists the organization's documents", async () => {
    vi.mocked(application.listDocuments).mockResolvedValue([documentRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: DOCUMENT_ID,
          title: "Opening procedure",
          category: "routine",
          audience: "all_staff",
          status: "published",
          ownerId: null,
          createdAt: "2026-01-01T08:00:00.000Z",
          updatedAt: null,
        },
      ],
    });
    expect(application.listDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes a manager's category/audience/status filters through", async () => {
    const response = await GET(
      getRequest("?category=policy&audience=managers&status=draft&limit=10&offset=5"),
    );

    expect(response.status).toBe(200);
    expect(application.listDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        category: "policy",
        audience: "managers",
        status: "draft",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it("forces published + all_staff for a non-manager", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, audience: "all_staff", status: "published" }),
    );
  });

  it("allows a non-manager to pass the published all_staff filters explicitly", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(getRequest("?status=published&audience=all_staff"));

    expect(response.status).toBe(200);
    expect(application.listDocuments).toHaveBeenCalled();
  });

  it("returns 403 when a non-manager filters for a draft", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(getRequest("?status=draft"));

    expect(response.status).toBe(403);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-manager filters for a managers-audience document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await GET(getRequest("?audience=managers"));

    expect(response.status).toBe(403);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });

  it.each([
    "owner",
    "general_manager",
    "location_manager",
    "kitchen",
    "front_of_house",
    "purchasing",
    "finance",
    "admin",
    "analyst",
  ])("allows %s to read the library", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(application.listDocuments).toHaveBeenCalled();
  });

  it("returns 403 for an unknown role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["intruder"]));

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });

  it("returns 400 for a status outside the vocabulary", async () => {
    const response = await GET(getRequest("?status=bogus"));

    expect(response.status).toBe(400);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"));

    expect(response.status).toBe(400);
    expect(application.listDocuments).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/documents", () => {
  it("creates a document for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.createDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        title: "Opening procedure",
        category: "routine",
        audience: "all_staff",
        ownerId: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, documentId: DOCUMENT_ID });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to create a document",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(200);
      expect(application.createDocument).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not manage documents",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest(validBody));

      expect(response.status).toBe(403);
      expect(application.createDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a bad category", async () => {
    const response = await POST(postRequest({ ...validBody, category: "bogus" }));

    expect(response.status).toBe(400);
    expect(application.createDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad audience", async () => {
    const response = await POST(postRequest({ ...validBody, audience: "everyone" }));

    expect(response.status).toBe(400);
    expect(application.createDocument).not.toHaveBeenCalled();
  });

  it("returns 400 when the title is missing", async () => {
    const response = await POST(postRequest({ category: "routine", audience: "all_staff" }));

    expect(response.status).toBe(400);
    expect(application.createDocument).not.toHaveBeenCalled();
  });

  it("returns 403 when the request is not same-origin", async () => {
    const response = await POST(postRequest(validBody, false));

    expect(response.status).toBe(403);
    expect(application.createDocument).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createDocument).mockRejectedValue(
      new DomainError("title must not be blank"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "title must not be blank" });
  });
});
