import type {
  DocumentAcknowledgementRecord,
  DocumentRecord,
  UserAccess,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresDocumentsStore: vi.fn(() => ({})),
    findDocument: vi.fn(),
    listDocumentAcknowledgements: vi.fn(),
    acknowledgeDocument: vi.fn(),
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
const ACK_ID = "55555555-5555-4555-8555-555555555555";
const ACKNOWLEDGER_ID = "66666666-6666-4666-8666-666666666666";
const PATH = `/api/v1/documents/${DOCUMENT_ID}/acknowledgements`;

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

function acknowledgementRecord(
  overrides: Partial<DocumentAcknowledgementRecord> = {},
): DocumentAcknowledgementRecord {
  return {
    id: ACK_ID,
    organizationId: ORG,
    documentVersionId: VERSION_ID,
    acknowledgedBy: USER,
    acknowledgedAt: "2026-03-01T09:00:00.000Z",
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
  vi.mocked(application.listDocumentAcknowledgements).mockResolvedValue([]);
  vi.mocked(application.acknowledgeDocument).mockResolvedValue(acknowledgementRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/documents/[id]/acknowledgements", () => {
  it("lists the acknowledgement register for a manager", async () => {
    vi.mocked(application.listDocumentAcknowledgements).mockResolvedValue([
      acknowledgementRecord(),
    ]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    expect(application.listDocumentAcknowledgements).toHaveBeenCalledWith(
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
          id: ACK_ID,
          documentVersionId: VERSION_ID,
          acknowledgedBy: USER,
          acknowledgedAt: "2026-03-01T09:00:00.000Z",
        },
      ],
    });
  });

  it("passes the version and acknowledger filters through", async () => {
    const response = await GET(
      getRequest(
        `?documentVersionId=${VERSION_ID}&acknowledgedBy=${ACKNOWLEDGER_ID}&limit=5&offset=2`,
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(application.listDocumentAcknowledgements).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentVersionId: VERSION_ID,
        acknowledgedBy: ACKNOWLEDGER_ID,
        limit: 5,
        offset: 2,
      }),
    );
  });

  it("scopes the register to the path document", async () => {
    const otherDocumentId = "33333333-3333-4333-8333-333333333333";

    const response = await GET(getRequest(), context(otherDocumentId));

    expect(response.status).toBe(200);
    expect(application.findDocument).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      documentId: otherDocumentId,
    });
    expect(application.listDocumentAcknowledgements).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentId: otherDocumentId }),
    );
  });

  it.each(["owner", "general_manager", "location_manager", "admin"])(
    "allows %s to read the register",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(200);
    },
  );

  it.each(["kitchen", "front_of_house", "purchasing", "finance", "analyst"])(
    "returns 403 for %s, which may not read the register",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest(), context());

      expect(response.status).toBe(403);
      expect(application.listDocumentAcknowledgements).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown document", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(404);
    expect(application.listDocumentAcknowledgements).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
  });

  it("returns 400 for a non-UUID documentVersionId", async () => {
    const response = await GET(getRequest("?documentVersionId=nope"), context());

    expect(response.status).toBe(400);
    expect(application.listDocumentAcknowledgements).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.findDocument).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/documents/[id]/acknowledgements", () => {
  it("acknowledges a document for the session actor", async () => {
    const response = await POST(postRequest({ documentVersionId: VERSION_ID }), context());

    expect(response.status).toBe(200);
    expect(application.acknowledgeDocument).toHaveBeenCalledWith(
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
      acknowledgement: {
        id: ACK_ID,
        documentVersionId: VERSION_ID,
        acknowledgedBy: USER,
        acknowledgedAt: "2026-03-01T09:00:00.000Z",
      },
    });
  });

  it("acknowledges the latest version when no version is named", async () => {
    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(200);
    expect(application.acknowledgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, documentId: DOCUMENT_ID }),
    );
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
  ])("allows %s to acknowledge a published all_staff document", async (role) => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(200);
    expect(application.acknowledgeDocument).toHaveBeenCalled();
  });

  it("denies a non-manager a draft document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["kitchen"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ status: "draft" }));

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(403);
    expect(application.acknowledgeDocument).not.toHaveBeenCalled();
  });

  it("denies a non-manager a managers-audience document", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    vi.mocked(application.findDocument).mockResolvedValue(documentRecord({ audience: "managers" }));

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(403);
    expect(application.acknowledgeDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown document", async () => {
    vi.mocked(application.findDocument).mockResolvedValue(undefined);

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(404);
    expect(application.acknowledgeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID documentVersionId", async () => {
    const response = await POST(postRequest({ documentVersionId: "nope" }), context());

    expect(response.status).toBe(400);
    expect(application.acknowledgeDocument).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await POST(postRequest({}), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.acknowledgeDocument).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.acknowledgeDocument).mockRejectedValue(
      new DomainError("no published version to acknowledge"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "no published version to acknowledge",
    });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.acknowledgeDocument).mockRejectedValue(
      new NotFoundError("document version not found in organization"),
    );

    const response = await POST(postRequest({}), context());

    expect(response.status).toBe(404);
  });
});
