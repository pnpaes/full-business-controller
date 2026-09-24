import type { RecipeTestView } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresRecipeStore: vi.fn(() => ({})),
    listRecipeTests: vi.fn(),
    recordRecipeTest: vi.fn(),
  };
});

vi.mock("../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));
vi.mock("../../../../../../lib/same-origin", () => ({ assertSameOrigin: vi.fn() }));

import * as application from "@aquarela/application";

import { assertSameOrigin } from "../../../../../../lib/same-origin";
import { getServerSession } from "../../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RECIPE = "11111111-1111-4111-8111-111111111111";
const VERSION = "55555555-5555-4555-8555-555555555555";
const PATH = `/api/v1/recipes/${RECIPE}/tests`;

function view(overrides: Partial<RecipeTestView> = {}): RecipeTestView {
  return {
    id: "test-1",
    organizationId: ORG,
    recipeId: RECIPE,
    recipeVersionId: VERSION,
    testedAt: new Date("2026-02-01T00:00:00.000Z"),
    batchInputQty: "2.000000",
    actualOutputQty: "1.750000",
    actualDurationMinutes: 45,
    actualCost: "12.5000",
    currency: "NOK",
    qualityComments: "dry",
    proposedAdjustment: "more water",
    resultingRecipeVersionId: null,
    actorId: USER,
    createdAt: new Date("2026-02-01T09:00:00.000Z"),
    testedVersionNo: 1,
    testedVersionState: "approved",
    resultingVersionNo: null,
    resultingVersionState: null,
    ...overrides,
  };
}

function row(overrides: Partial<RecipeTestView> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...view(overrides) };
  delete record.organizationId;
  record.testedAt = "2026-02-01T00:00:00.000Z";
  record.createdAt = "2026-02-01T09:00:00.000Z";
  return record;
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

function context(id = RECIPE): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const validBody = {
  recipeVersionId: VERSION,
  testedAt: "2026-02-01T00:00:00.000Z",
  batchInputQty: "2.000000",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertSameOrigin).mockReset();
  vi.mocked(application.createPostgresRecipeStore).mockReturnValue({} as never);
  vi.mocked(application.listRecipeTests).mockResolvedValue([]);
  vi.mocked(application.recordRecipeTest).mockResolvedValue({ recipeTestId: "test-1" });
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("GET /api/v1/recipes/[id]/tests", () => {
  it("lists the recipe's trials through the shared row mapper", async () => {
    vi.mocked(application.listRecipeTests).mockResolvedValue([view()]);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, tests: [row()] });
    expect(application.listRecipeTests).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, recipeId: RECIPE }),
    );
  });

  it("narrows to one version with the query filter", async () => {
    const response = await GET(getRequest(`?recipeVersionId=${VERSION}`), context());

    expect(response.status).toBe(200);
    expect(application.listRecipeTests).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, recipeId: RECIPE, recipeVersionId: VERSION }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(401);
    expect(application.listRecipeTests).not.toHaveBeenCalled();
  });

  it.each(["?recipeVersionId=nope"])("returns 400 for the malformed query %s", async (query) => {
    const response = await GET(getRequest(query), context());

    expect(response.status).toBe(400);
    expect(application.listRecipeTests).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID recipe id", async () => {
    const response = await GET(getRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(application.listRecipeTests).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400", async () => {
    vi.mocked(application.listRecipeTests).mockRejectedValue(
      new DomainError("listRecipeTests requires a recipeId or a recipeVersionId"),
    );

    const response = await GET(getRequest(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "listRecipeTests requires a recipeId or a recipeVersionId",
    });
  });
});

describe("POST /api/v1/recipes/[id]/tests", () => {
  it("records a trial for the session actor and served organization", async () => {
    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, recipeTestId: "test-1" });
    expect(application.recordRecipeTest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        recipeVersionId: VERSION,
        batchInputQty: "2.000000",
      }),
    );
  });

  it("returns 403 for a cross-origin mutation", async () => {
    vi.mocked(assertSameOrigin).mockImplementation(() => {
      throw new Error("cross-origin");
    });

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(403);
    expect(application.recordRecipeTest).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(401);
    expect(application.recordRecipeTest).not.toHaveBeenCalled();
  });

  it.each([{}, { ...validBody, recipeVersionId: "nope" }, { ...validBody, batchInputQty: "" }])(
    "returns 400 for the malformed body %j",
    async (body) => {
      const response = await POST(postRequest(body), context());

      expect(response.status).toBe(400);
      expect(application.recordRecipeTest).not.toHaveBeenCalled();
    },
  );

  it("maps a NotFoundError to 404", async () => {
    vi.mocked(application.recordRecipeTest).mockRejectedValue(
      new NotFoundError("recipe version not found in organization"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(404);
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.recordRecipeTest).mockRejectedValue(
      new DomainError("batchInputQty must be positive"),
    );

    const response = await POST(postRequest(validBody), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "batchInputQty must be positive" });
  });
});
