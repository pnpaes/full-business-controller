import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductStore: vi.fn(() => ({})),
    findProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
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
const VARIANT_ID = "33333333-3333-4333-8333-333333333333";

const context = { params: Promise.resolve({ id: VARIANT_ID }) };

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/v1/products/variants/${VARIANT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function variant() {
  return {
    id: VARIANT_ID,
    organizationId: ORG,
    productId: "p1",
    code: "V1",
    sku: "S1",
    name: "V1",
    size: null,
    finishedGoodItemId: null,
    activeFrom: "2026-01-01",
    activeTo: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresProductStore).mockReturnValue({} as never);
  vi.mocked(application.findProductVariant).mockResolvedValue({
    variant: variant(),
    product: { id: "p1", code: "CAKE", name: "Cake" },
    recipeAssignments: [],
    addonApplicability: [],
  });
  vi.mocked(application.updateProductVariant).mockResolvedValue({ productVariantId: VARIANT_ID });
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/products/variants/[id]", () => {
  it("returns the variant detail", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { variant: { code: string } };
    expect(body.variant.code).toBe("V1");
  });

  it("returns 404 for an unknown variant and 400 for a malformed id", async () => {
    vi.mocked(application.findProductVariant).mockRejectedValue(
      new DomainError("product variant not found in organization"),
    );
    expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
    expect(
      (await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "nope" }) }))
        .status,
    ).toBe(400);
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(401);
  });
});

describe("PATCH /api/v1/products/variants/[id]", () => {
  it("updates the mutable fields", async () => {
    const response = await PATCH(
      patchRequest({ name: "Renamed", size: "", finishedGoodItemId: null }),
      context,
    );
    expect(response.status).toBe(200);
    expect(application.updateProductVariant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        productVariantId: VARIANT_ID,
        name: "Renamed",
        size: null,
        finishedGoodItemId: null,
      }),
    );
  });

  it("returns 400 for an empty or unknown body", async () => {
    expect((await PATCH(patchRequest({}), context)).status).toBe(400);
    expect((await PATCH(patchRequest({ sku: "NOPE" }), context)).status).toBe(400);
    expect(application.updateProductVariant).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.updateProductVariant).mockRejectedValue(
      new DomainError("finished-good item not found in this organization"),
    );
    const response = await PATCH(patchRequest({ finishedGoodItemId: VARIANT_ID }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "finished-good item not found in this organization",
    });
  });
});
