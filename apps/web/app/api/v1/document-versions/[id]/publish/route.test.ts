import type { DocumentVersionRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    findDocumentVersion: vi.fn(),
    publishDocumentVersion: vi.fn(),
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

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/document-versions/${VERSION_ID}/publish`;

function versionRecord(overrides: Partial<DocumentVersionRecord> = {}): DocumentVersionRecord {
  return {
    id: VERSION_ID,
    organizationId: ORG,
    documentId: DOCUMENT_ID,
    version: 1,
    fileObjectId: null,
    notes: null,
    publishedAt: null,
    publishedBy: null,
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

function publishRequest(): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocumentVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.publishDocumentVersion).mockResolvedValue(
    versionRecord({ publishedAt: "2026-02-01T09:00:00.000Z", publishedBy: USER }),
  );
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/document-versions/[id]/publish", () => {
  it("publishes a version, resolving its parent document id", async () => {
    const response = await POST(publishRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findDocumentVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentVersionId: VERSION_ID }),
    );
    expect(application.publishDocumentVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      documentVersion: {
        id: VERSION_ID,
        documentId: DOCUMENT_ID,
        version: 1,
        fileObjectId: null,
        notes: null,
        publishedAt: "2026-02-01T09:00:00.000Z",
        publishedBy: USER,
        createdAt: "2026-01-02T08:00:00.000Z",
      },
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to publish a version",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(publishRequest(), context());

      expect(response.status).toBe(200);
      expect(application.publishDocumentVersion).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not publish",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(publishRequest(), context());

      expect(response.status).toBe(403);
      expect(application.publishDocumentVersion).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown version before publishing", async () => {
    vi.mocked(application.findDocumentVersion).mockResolvedValue(undefined);

    const response = await POST(publishRequest(), context());

    expect(response.status).toBe(404);
    expect(application.publishDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(publishRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.publishDocumentVersion).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.publishDocumentVersion).mockRejectedValue(
      new DomainError("document is archived"),
    );

    const response = await POST(publishRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "document is archived" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.publishDocumentVersion).mockRejectedValue(
      new NotFoundError("document version not found in organization"),
    );

    const response = await POST(publishRequest(), context());

    expect(response.status).toBe(404);
  });
});
