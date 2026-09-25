import type {
  EmployeeDocumentRecord,
  EmployeeRecord,
  FileObjectRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    createPostgresFileObjectsStore: vi.fn(() => ({})),
    createEmployeeDocument: vi.fn(),
    findEmployee: vi.fn(),
    listEmployeeDocuments: vi.fn(),
    storeFileObject: vi.fn(),
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
import { getServerSession } from "../../../../../../../lib/server-session";

import { EMPLOYEE_DOCUMENT_UPLOAD_POLICY } from "../../../workforce-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const LOCATION = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/workforce/employees/${EMPLOYEE_ID}/documents`;

function employeeRecord(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id: EMPLOYEE_ID,
    organizationId: ORG,
    userId: null,
    name: "Ana Silva",
    roleCode: "line_cook",
    employmentType: "full_time",
    baseHourlyRate: "12.5000",
    costCenterId: null,
    primaryLocationId: LOCATION,
    activeFrom: "2026-01-01",
    activeTo: null,
    retiredAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function documentRecord(overrides: Partial<EmployeeDocumentRecord> = {}): EmployeeDocumentRecord {
  return {
    id: DOCUMENT_ID,
    organizationId: ORG,
    employeeId: EMPLOYEE_ID,
    kind: "contract",
    title: "Contract 2026",
    fileObjectId: null,
    issuedAt: "2026-01-01",
    expiresAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    createdBy: USER,
    ...overrides,
  };
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function context(id: string = EMPLOYEE_ID): { readonly params: Promise<{ readonly id: string }> } {
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

function fileRecord(overrides: Partial<FileObjectRecord> = {}): FileObjectRecord {
  return {
    id: FILE_ID,
    organizationId: ORG,
    storageKey: `${ORG}/key.pdf`,
    filename: "contract.pdf",
    mime: "application/pdf",
    sizeBytes: 8,
    checksumSha256: "a".repeat(64),
    retentionPolicy: "employee_document",
    uploadedBy: USER,
    uploadedAt: "2026-01-01T08:00:00.000Z",
    linkedEntityType: "employee",
    linkedEntityId: EMPLOYEE_ID,
    createdAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

function uploadRequest(
  fields: Record<string, string> = { kind: "contract", title: "Contract 2026" },
  file?: { bytes?: Uint8Array; filename?: string; type?: string },
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (file !== undefined) {
    form.append(
      "file",
      new File(
        [Uint8Array.from(file.bytes ?? new TextEncoder().encode("contract"))],
        file.filename ?? "contract.pdf",
        { type: file.type ?? "application/pdf" },
      ),
    );
  }
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresFileObjectsStore).mockReturnValue({} as never);
  vi.mocked(application.findEmployee).mockResolvedValue(employeeRecord());
  vi.mocked(application.listEmployeeDocuments).mockResolvedValue([]);
  vi.mocked(application.createEmployeeDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.storeFileObject).mockResolvedValue(fileRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/employees/[id]/documents", () => {
  it("lists the employee's documents", async () => {
    vi.mocked(application.listEmployeeDocuments).mockResolvedValue([documentRecord()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findEmployee).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, employeeId: EMPLOYEE_ID }),
    );
    expect(application.listEmployeeDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        employeeId: EMPLOYEE_ID,
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
          id: DOCUMENT_ID,
          employeeId: EMPLOYEE_ID,
          kind: "contract",
          title: "Contract 2026",
          fileObjectId: null,
          issuedAt: "2026-01-01",
          expiresAt: null,
          createdAt: "2026-01-01T08:00:00.000Z",
          createdBy: USER,
        },
      ],
    });
  });

  it("passes the kind filter through", async () => {
    const response = await GET(getRequest("?kind=certificate&limit=5&offset=10"), context());

    expect(response.status).toBe(200);
    expect(application.listEmployeeDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "certificate", limit: 5, offset: 10 }),
    );
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to read documents", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which has no personnel-document access",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(application.listEmployeeDocuments).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a cross-organization/unknown employee id", async () => {
    vi.mocked(application.findEmployee).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listEmployeeDocuments).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listEmployeeDocuments).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range offset", async () => {
    const response = await GET(getRequest("?offset=999999999999"), context());

    expect(response.status).toBe(400);
    expect(application.findEmployee).not.toHaveBeenCalled();
  });

  it("returns 400 for a kind outside the vocabulary", async () => {
    const response = await GET(getRequest("?kind=bogus"), context());

    expect(response.status).toBe(400);
    expect(application.listEmployeeDocuments).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/workforce/employees/[id]/documents", () => {
  it("creates a document on the path employee for the session actor", async () => {
    const response = await POST(
      postRequest({ kind: "contract", title: "Contract 2026" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(application.findEmployee).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, employeeId: EMPLOYEE_ID }),
    );
    expect(application.createEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        employeeId: EMPLOYEE_ID,
        kind: "contract",
        title: "Contract 2026",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      employeeDocumentId: DOCUMENT_ID,
      kind: "contract",
      fileObjectId: null,
    });
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to create a document", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await POST(postRequest({ kind: "contract", title: "C" }), context());

    expect(response.status).toBe(200);
    expect(application.createEmployeeDocument).toHaveBeenCalled();
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not create a personnel document",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(postRequest({ kind: "contract", title: "C" }), context());

      expect(response.status).toBe(403);
      expect(application.createEmployeeDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a cross-organization employee id before creating", async () => {
    vi.mocked(application.findEmployee).mockResolvedValue(undefined);

    const response = await POST(
      postRequest({ kind: "contract", title: "Contract 2026" }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(application.createEmployeeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad document kind", async () => {
    const response = await POST(postRequest({ kind: "passport", title: "C" }), context());

    expect(response.status).toBe(400);
    expect(application.createEmployeeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(
      postRequest({ kind: "contract", title: "C" }),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(application.createEmployeeDocument).not.toHaveBeenCalled();
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.createEmployeeDocument).mockRejectedValue(
      new NotFoundError("employee not found in organization"),
    );

    const response = await POST(
      postRequest({ kind: "contract", title: "Contract 2026" }),
      context(),
    );

    expect(response.status).toBe(404);
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.createEmployeeDocument).mockRejectedValue(
      new DomainError("expiresAt must not precede issuedAt"),
    );

    const response = await POST(
      postRequest({ kind: "contract", title: "Contract 2026" }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "expiresAt must not precede issuedAt",
    });
  });
});

describe("POST /api/v1/workforce/employees/[id]/documents (multipart upload)", () => {
  it("stores the file linked to the employee and links the created document", async () => {
    vi.mocked(application.createEmployeeDocument).mockResolvedValue(
      documentRecord({ fileObjectId: FILE_ID }),
    );

    const response = await POST(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        filename: "contract.pdf",
        mime: "application/pdf",
        retentionPolicy: "employee_document",
        linkedEntityType: "employee",
        linkedEntityId: EMPLOYEE_ID,
      }),
    );
    expect(application.createEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: EMPLOYEE_ID, fileObjectId: FILE_ID }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      employeeDocumentId: DOCUMENT_ID,
      fileObjectId: FILE_ID,
    });
  });

  it("ignores a client fileObjectId form field (ADR-0003)", async () => {
    vi.mocked(application.createEmployeeDocument).mockResolvedValue(
      documentRecord({ fileObjectId: FILE_ID }),
    );

    const response = await POST(
      uploadRequest({ kind: "contract", title: "C", fileObjectId: DOCUMENT_ID }, {}),
      context(),
    );

    expect(response.status).toBe(200);
    expect(application.createEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileObjectId: FILE_ID }),
    );
  });

  it.each(["text/plain", "application/zip", "text/html"])(
    "returns 400 and stores nothing for the disallowed type %s",
    async (type) => {
      const response = await POST(uploadRequest(undefined, { type }), context());

      expect(response.status).toBe(400);
      expect(application.storeFileObject).not.toHaveBeenCalled();
      expect(application.createEmployeeDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 400 and stores nothing for an oversize upload", async () => {
    const bytes = new Uint8Array(EMPLOYEE_DOCUMENT_UPLOAD_POLICY.maxBytes + 1);

    const response = await POST(uploadRequest(undefined, { bytes }), context());

    expect(response.status).toBe(400);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });

  it("creates metadata only when no file part is present", async () => {
    const response = await POST(uploadRequest({ kind: "contract", title: "Verbal" }), context());

    expect(response.status).toBe(200);
    expect(application.storeFileObject).not.toHaveBeenCalled();
    expect(application.createEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileObjectId: null }),
    );
  });

  it("returns 404 for a cross-organization employee and stores nothing", async () => {
    vi.mocked(application.findEmployee).mockResolvedValue(undefined);

    const response = await POST(uploadRequest(undefined, {}), context());

    expect(response.status).toBe(404);
    expect(application.storeFileObject).not.toHaveBeenCalled();
  });
});
