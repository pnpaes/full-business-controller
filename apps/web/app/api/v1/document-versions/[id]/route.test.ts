import type { DocumentVersionRecord, UserAccess } from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    findDocumentVersion: vi.fn(),
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

import { getServerSession } from "../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/document-versions/${VERSION_ID}`;

function versionRecord(overrides: Partial<DocumentVersionRecord> = {}): DocumentVersionRecord {
  return {
    id: VERSION_ID,
    organizationId: ORG,
    documentId: DOCUMENT_ID,
    version: 1,
    fileObjectId: null,
    notes: null,
    publishedAt: "2026-01-02T08:00:00.000Z",
    publishedBy: USER,
    createdAt: "2026-01-02T08:00:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = VERSION_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocumentVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/document-versions/[id]", () => {
  it("returns one version to a manager", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findDocumentVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentVersionId: VERSION_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      documentVersion: {
        id: VERSION_ID,
        documentId: DOCUMENT_ID,
        version: 1,
        fileObjectId: null,
        notes: null,
        publishedAt: "2026-01-02T08:00:00.000Z",
        publishedBy: USER,
        createdAt: "2026-01-02T08:00:00.000Z",
      },
    });
  });

  it("returns a superseded (unpublished) version to a manager", async () => {
    vi.mocked(application.findDocumentVersion).mockResolvedValue(
      versionRecord({ version: 1, publishedAt: null, publishedBy: null }),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      documentVersion: { version: 1, publishedAt: null },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to read a version",
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
      expect(application.findDocumentVersion).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown/cross-organization version", async () => {
    vi.mocked(application.findDocumentVersion).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findDocumentVersion).not.toHaveBeenCalled();
  });
});
