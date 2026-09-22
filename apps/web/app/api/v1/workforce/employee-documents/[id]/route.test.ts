import type { EmployeeDocumentRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresWorkforceStore: vi.fn(() => ({})),
    findEmployeeDocument: vi.fn(),
    updateEmployeeDocument: vi.fn(),
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

import { GET, PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/api/v1/workforce/employee-documents/${DOCUMENT_ID}`;

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
  vi.mocked(application.createPostgresWorkforceStore).mockReturnValue({} as never);
  vi.mocked(application.findEmployeeDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.updateEmployeeDocument).mockResolvedValue(documentRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/employee-documents/[id]", () => {
  it("returns one personnel document", async () => {
    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.findEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, employeeDocumentId: DOCUMENT_ID }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      document: {
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
    });
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to read a document", async (role) => {
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
      expect(application.findEmployeeDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown/cross-organization document", async () => {
    vi.mocked(application.findEmployeeDocument).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.findEmployeeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findEmployeeDocument).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/workforce/employee-documents/[id]", () => {
  it("replaces a document's metadata for the session actor", async () => {
    vi.mocked(application.updateEmployeeDocument).mockResolvedValue(
      documentRecord({ title: "Contract 2026 (signed)" }),
    );

    const response = await PATCH(patchRequest({ title: "Contract 2026 (signed)" }), context());

    expect(response.status).toBe(200);
    expect(application.updateEmployeeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        employeeDocumentId: DOCUMENT_ID,
        title: "Contract 2026 (signed)",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      document: { title: "Contract 2026 (signed)" },
    });
  });

  it.each(["owner", "general_manager", "admin"])("allows %s to update a document", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await PATCH(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(200);
    expect(application.updateEmployeeDocument).toHaveBeenCalled();
  });

  it.each(["finance", "location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not update a personnel document",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await PATCH(patchRequest({ title: "Renamed" }), context());

      expect(response.status).toBe(403);
      expect(application.updateEmployeeDocument).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a bad document kind", async () => {
    const response = await PATCH(patchRequest({ kind: "passport" }), context());

    expect(response.status).toBe(400);
    expect(application.updateEmployeeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ title: "Renamed" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.updateEmployeeDocument).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.updateEmployeeDocument).mockRejectedValue(
      new DomainError("expiresAt must not precede issuedAt"),
    );

    const response = await PATCH(patchRequest({ expiresAt: "2025-01-01" }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "expiresAt must not precede issuedAt",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.updateEmployeeDocument).mockRejectedValue(
      new NotFoundError("employee document not found in organization"),
    );

    const response = await PATCH(patchRequest({ title: "Renamed" }), context());

    expect(response.status).toBe(404);
  });
});
