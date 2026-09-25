import type {
  DocumentRecord,
  DocumentVersionRecord,
  FileObjectRecord,
  StoredFile,
  UserAccess,
} from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findDocumentVersion: vi.fn(),
    findDocument: vi.fn(),
    findCurrentPublishedVersion: vi.fn(),
    readFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));
vi.mock("../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/document-versions/${VERSION_ID}/file`;
const BYTES = new TextEncoder().encode("stored handbook bytes");

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
    publishedAt: "2026-02-01T08:00:00.000Z",
    publishedBy: USER,
    createdAt: "2026-02-01T08:00:00.000Z",
    ...overrides,
  };
}

function fileRecord(): FileObjectRecord {
  return {
    id: FILE_ID,
    organizationId: ORG,
    storageKey: `${ORG}/key.pdf`,
    filename: "handbook.pdf",
    mime: "application/pdf",
    sizeBytes: BYTES.byteLength,
    checksumSha256: "a".repeat(64),
    retentionPolicy: "document_library",
    uploadedBy: USER,
    uploadedAt: "2026-02-01T08:00:00.000Z",
    linkedEntityType: "document",
    linkedEntityId: DOCUMENT_ID,
    createdAt: "2026-02-01T08:00:00.000Z",
  };
}

function storedFile(): StoredFile {
  return { metadata: fileRecord(), bytes: BYTES };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = VERSION_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresDocumentsStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findDocumentVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.findDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.findCurrentPublishedVersion).mockResolvedValue(versionRecord());
  vi.mocked(application.readFileObject).mockResolvedValue(storedFile());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/document-versions/[id]/file", () => {
  it("streams the stored bytes with an attachment disposition", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Length")).toBe(String(BYTES.byteLength));
    expect(response.headers.get("Content-Disposition")).toContain("handbook.pdf");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("lets a manager download any version's file", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    // A superseded version: current differs.
    vi.mocked(application.findCurrentPublishedVersion).mockResolvedValue(
      versionRecord({ id: OTHER_VERSION_ID }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
  });

  it("lets a non-manager download the current published all_staff version", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(application.readFileObject).toHaveBeenCalled();
  });

  it("returns 403 when a non-manager asks for a superseded version", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen", "front_of_house"]));
    vi.mocked(application.findCurrentPublishedVersion).mockResolvedValue(
      versionRecord({ id: OTHER_VERSION_ID }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(403);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-manager on a manager-audience document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ audience: "managers" }));

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(403);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 for a version with no attached file", async () => {
    vi.mocked(application.findDocumentVersion).mockResolvedValue(
      versionRecord({ fileObjectId: null }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown version", async () => {
    vi.mocked(application.findDocumentVersion).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 404 when the stored file object is unknown to the organization", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 403 for a role outside the read set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["contractor"]));

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(403);
    expect(application.findDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(401);
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/document-versions/nope/file"),
      context("nope"),
    );

    expect(response.status).toBe(400);
    expect(application.findDocumentVersion).not.toHaveBeenCalled();
  });
});
