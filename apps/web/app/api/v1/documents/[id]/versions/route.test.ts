import type { DocumentRecord, DocumentVersionRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    findDocument: vi.fn(),
    listDocumentVersions: vi.fn(),
    createDocumentVersion: vi.fn(),
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

import { requireSession } from "../../../../../../lib/auth";
import { getServerSession } from "../../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/documents/${DOCUMENT_ID}/versions`;

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

function versionRecord(overrides: Partial<DocumentVersionRecord> = {}): DocumentVersionRecord {
  return {
    id: VERSION_ID,
    organizationId: ORG,
    documentId: DOCUMENT_ID,
    version: 2,
    fileObjectId: null,
    notes: "second revision",
    publishedAt: null,
    publishedBy: null,
    createdAt: "2026-02-01T08:00:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = DOCUMENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.listDocumentVersions).mockResolvedValue([]);
  vi.mocked(application.createDocumentVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/documents/[id]/versions", () => {
  it("lists the document's versions", async () => {
    vi.mocked(application.listDocumentVersions).mockResolvedValue([versionRecord()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.listDocumentVersions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        documentId: DOCUMENT_ID,
        limit: 50,
        offset: 0,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [
        {
          id: VERSION_ID,
          documentId: DOCUMENT_ID,
          version: 2,
          fileObjectId: null,
          notes: "second revision",
          publishedAt: null,
          publishedBy: null,
          createdAt: "2026-02-01T08:00:00.000Z",
        },
      ],
    });
  });

  it("passes the paging through", async () => {
    const response = await GET(getRequest("?limit=5&offset=10"), context());

    expect(response.status).toBe(200);
    expect(application.listDocumentVersions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5, offset: 10 }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to read the version chain",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not read superseded versions",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(application.listDocumentVersions).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown document", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listDocumentVersions).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"), context());

    expect(response.status).toBe(400);
    expect(application.findDocument).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/documents/[id]/versions", () => {
  it("creates a version for the session actor", async () => {
    const response = await POST(postRequest({ notes: "second revision" }), context());

    expect(response.status).toBe(200);
    expect(application.createDocumentVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        documentId: DOCUMENT_ID,
        notes: "second revision",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      documentVersionId: VERSION_ID,
      version: 2,
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to create a version",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({}), context());

      expect(response.status).toBe(200);
      expect(application.createDocumentVersion).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not create a version",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({}), context());

      expect(response.status).toBe(403);
      expect(application.createDocumentVersion).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown document before creating", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(404);
    expect(application.createDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID fileObjectId", async () => {
    const response = await POST(postRequest({ fileObjectId: "nope" }), context());

    expect(response.status).toBe(400);
    expect(application.createDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest({}), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.createDocumentVersion).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createDocumentVersion).mockRejectedValue(
      new DomainError("document is archived"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "document is archived" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.createDocumentVersion).mockRejectedValue(
      new NotFoundError("document not found in organization"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(404);
  });
});
