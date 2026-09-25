import type {
  EmployeeDocumentRecord,
  FileObjectRecord,
  StoredFile,
  UserAccess,
} from "@aquarela/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    findEmployeeDocument: vi.fn(),
    readFileObject: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/file-storage", () => ({ getFileStorage: vi.fn(() => ({})) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getServerSession } from "../../../../../../../lib/server-session";

import { GET } from "./route";

const ORG = "org-1";
const USER = "user-1";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/workforce/employee-documents/${DOCUMENT_ID}/file`;

function documentRecord(overrides: Partial<EmployeeDocumentRecord> = {}): EmployeeDocumentRecord {
  return {
    id: DOCUMENT_ID,
    organizationId: ORG,
    employeeId: EMPLOYEE_ID,
    kind: "contract",
    title: "Contract 2026",
    fileObjectId: FILE_ID,
    issuedAt: null,
    expiresAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function storedFile(overrides: Partial<FileObjectRecord> = {}): StoredFile {
  return {
    metadata: {
      id: FILE_ID,
      organizationId: ORG,
      storageKey: `${ORG}/key.pdf`,
      filename: "contract.pdf",
      mime: "application/pdf",
      sizeBytes: 3,
      checksumSha256: "a".repeat(64),
      retentionPolicy: "employee_document",
      uploadedBy: USER,
      uploadedAt: "2026-01-01T08:00:00.000Z",
      linkedEntityType: "employee",
      linkedEntityId: EMPLOYEE_ID,
      createdAt: "2026-01-01T08:00:00.000Z",
      ...overrides,
    },
    bytes: new TextEncoder().encode("pdf"),
  };
}

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

function context(id: string = DOCUMENT_ID): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findEmployeeDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.readFileObject).mockResolvedValue(storedFile());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/workforce/employee-documents/[id]/file", () => {
  it("streams the stored bytes as a private attachment", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("pdf");
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to download", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(200);
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which has no personnel-document access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(new Request(`http://localhost${PATH}`), context());

      expect(response.status).toBe(403);
      expect(application.readFileObject).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined as never);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown or cross-organization document", async () => {
    vi.mocked(application.findEmployeeDocument).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the document has no stored file", async () => {
    vi.mocked(application.findEmployeeDocument).mockResolvedValue(
      documentRecord({ fileObjectId: null }),
    );

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
    expect(application.readFileObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the file object is outside the organization", async () => {
    vi.mocked(application.readFileObject).mockResolvedValue(undefined);

    const response = await GET(new Request(`http://localhost${PATH}`), context());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-UUID document id", async () => {
    const response = await GET(new Request(`http://localhost${PATH}`), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findEmployeeDocument).not.toHaveBeenCalled();
  });
});
