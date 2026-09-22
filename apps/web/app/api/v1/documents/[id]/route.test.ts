import type { DocumentRecord, DocumentVersionRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    findDocument: vi.fn(),
    findCurrentPublishedVersion: vi.fn(),
    updateDocument: vi.fn(),
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

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/documents/${DOCUMENT_ID}`;

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

function context(id: string = DOCUMENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request(`http://localhost${PATH}`);
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost${PATH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.findCurrentPublishedVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.updateDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/documents/[id]", () => {
  it("returns one document with its current published version", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentId: DOCUMENT_ID }),
    );
    expect(application.findCurrentPublishedVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentId: DOCUMENT_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      document: {
        id: DOCUMENT_ID,
        title: "Opening procedure",
        category: "routine",
        audience: "all_staff",
        status: "published",
        ownerId: null,
        createdAt: "2026-01-01T08:00:00.000Z",
        updatedAt: null,
      },
      currentVersion: {
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

  it("returns a null currentVersion when there is no published version", async () => {
    vi.mocked(application.findCurrentPublishedVersion).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ currentVersion: null });
  });

  it("keeps the current published version when a newer version is unpublished", async () => {
    // The store resolves the greatest *published* version (v1). A newer v2 draft
    // exists but is never consulted, so `currentVersion` is not blanked.
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findCurrentPublishedVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentId: DOCUMENT_ID }),
    );
    await expect(response.json()).resolves.toMatchObject({
      currentVersion: { id: VERSION_ID, version: 1 },
    });
  });

  it("lets a non-manager read a published all_staff document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
  });

  it("denies a non-manager a draft document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ status: "draft" }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
  });

  it("denies a non-manager a managers-audience document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ audience: "managers" }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
  });

  it("denies a non-manager an archived document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ status: "archived" }));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(403);
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
  ])("allows %s to read a published all_staff document", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown document", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findDocument).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/documents/[id]", () => {
  it("archives a document for the session actor", async () => {
    vi.mocked(application.updateDocument).mockResolvedValue(documentRecord({ status: "archived" }));

    const response = await PATCH(patchRequest({ status: "archived" }), context());

    expect(response.status).toBe(200);
    expect(application.findDocument).toHaveBeenCalled();
    expect(application.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        documentId: DOCUMENT_ID,
        status: "archived",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      document: { status: "archived" },
    });
  });

  it("updates a document's metadata", async () => {
    vi.mocked(application.updateDocument).mockResolvedValue(
      documentRecord({ title: "Opening procedure v2" }),
    );

    const response = await PATCH(patchRequest({ title: "Opening procedure v2" }), context());

    expect(response.status).toBe(200);
    expect(application.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentId: DOCUMENT_ID, title: "Opening procedure v2" }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to update a document",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ title: "Renamed" }), context());

      expect(response.status).toBe(200);
      expect(application.updateDocument).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not manage documents",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ title: "Renamed" }), context());

      expect(response.status).toBe(403);
      expect(application.updateDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 400 when the status is anything but archived", async () => {
    const response = await PATCH(patchRequest({ status: "published" }), context());

    expect(response.status).toBe(400);
    expect(application.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a status outside the vocabulary", async () => {
    const response = await PATCH(patchRequest({ status: "deleted" }), context());

    expect(response.status).toBe(400);
    expect(application.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad category", async () => {
    const response = await PATCH(patchRequest({ category: "bogus" }), context());

    expect(response.status).toBe(400);
    expect(application.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ title: "Renamed" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown document before updating", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(404);
    expect(application.updateDocument).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateDocument).mockRejectedValue(
      new DomainError("status may only be archived"),
    );

    const response = await PATCH(patchRequest({ status: "archived" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "status may only be archived" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateDocument).mockRejectedValue(
      new NotFoundError("document not found in organization"),
    );

    const response = await PATCH(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(404);
  });
});
