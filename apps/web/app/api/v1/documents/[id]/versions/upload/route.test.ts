import type {
  DocumentRecord,
  DocumentVersionRecord,
  FileObjectRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findDocument: vi.fn(),
    storeFileObject: vi.fn(),
    createDocumentVersion: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";

import { DOCUMENT_UPLOAD_POLICY } from "../../../document-rows";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/documents/${DOCUMENT_ID}/versions/upload`;

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
    fileObjectId: FILE_ID,
    notes: "with file",
    publishedAt: null,
    publishedBy: null,
    createdAt: "2026-02-01T08:00:00.000Z",
    ...overrides,
  };
}

function fileRecord(overrides: Partial<FileObjectRecord> = {}): FileObjectRecord {
  return {
    id: FILE_ID,
    organizationId: ORG,
    storageKey: `${ORG}/key.pdf`,
    filename: "handbook.pdf",
    mime: "application/pdf",
    sizeBytes: 12,
    checksumSha256: "a".repeat(64),
    retentionPolicy: "document_library",
    uploadedBy: USER,
    uploadedAt: "2026-02-01T08:00:00.000Z",
    linkedEntityType: "document",
    linkedEntityId: DOCUMENT_ID,
    createdAt: "2026-02-01T08:00:00.000Z",
    ...overrides,
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = DOCUMENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function uploadRequest(
  bytes: Uint8Array = new TextEncoder().encode("hello file"),
  filename = "handbook.pdf",
  type = "application/pdf",
  notes?: string,
): Request {
  const form = new FormData();
  form.append("file", new File([Uint8Array.from(bytes)], filename, { type }));
  if (notes !== undefined) {
    form.append("notes", notes);
  }
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body: form,
  });
}

/**
 * A multipart-shaped request whose `Content-Length` is far over the policy cap,
 * with a spy on `formData`. The route must reject from the header before ever
 * reading the body.
 */
function oversizeRequest(maxBytes: number): {
  readonly request: Request;
  readonly formData: ReturnType<typeof vi.fn>;
} {
  const formData = vi.fn(async () => {
    throw new Error("formData must not be reached");
  });
  const request = {
    url: `http://localhost${PATH}`,
    method: "POST",
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=----x",
      "content-length": String(maxBytes + 1024 * 1024),
      "sec-fetch-site": "same-origin",
    }),
    formData,
  } as unknown as Request;
  return { request, formData };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.storeFileObject).mockResolvedValue(fileRecord());
  vi.mocked(application.createDocumentVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/documents/[id]/versions/upload", () => {
  it("stores the file linked to the document and creates the version", async () => {
    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        filename: "handbook.pdf",
        mime: "application/pdf",
        retentionPolicy: "document_library",
        linkedEntityType: "document",
        linkedEntityId: DOCUMENT_ID,
      }),
    );
    expect(application.createDocumentVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        documentId: DOCUMENT_ID,
        fileObjectId: FILE_ID,
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      documentVersionId: VERSION_ID,
      version: 2,
      fileObjectId: FILE_ID,
      filename: "handbook.pdf",
      sizeBytes: 12,
    });
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to upload a version file",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(uploadRequest(), context());

      expect(response.status).toBe(200);
      expect(application.storeFileObject).toHaveBeenCalled();
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not manage documents",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(uploadRequest(), context());

      expect(response.status).toBe(403);
      expect(application.storeFileObject).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown document and stores nothing", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(404);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 400 for an archived document and stores nothing", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ status: "archived" }));

    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(uploadRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty upload", async () => {
    const response = await POST(uploadRequest(new Uint8Array(0)), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("rejects an oversize multipart body from Content-Length without reading it", async () => {
    const { request, formData } = oversizeRequest(DOCUMENT_UPLOAD_POLICY.maxBytes);

    const response = await POST(request, context());

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 400 and stores nothing for a MIME type outside the document allow-list", async () => {
    const response = await POST(
      uploadRequest(new TextEncoder().encode("x"), "notes.txt", "text/plain"),
      context(),
    );

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("returns 400 for a form with no file part", async () => {
    const form = new FormData();
    form.append("notes", "missing file");
    const request = new Request(`http://localhost${PATH}`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: form,
    });

    const response = await POST(request, context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("maps a store DomainError to 400 with its message", async () => {
    vi.mocked(application.storeFileObject).mockRejectedValue(new DomainError("file is empty"));

    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "file is empty" });
  });

  it("maps a typed NotFoundError from the version command to 404", async () => {
    vi.mocked(application.createDocumentVersion).mockRejectedValue(
      new NotFoundError("document not found in organization"),
    );

    const response = await POST(uploadRequest(), context());

    expect(response.status).toBe(404);
  });
});
