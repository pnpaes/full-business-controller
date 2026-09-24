import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductStore: vi.fn(() => ({})),
    registerProductVariant: vi.fn(),
  };
});

vi.mock("../../../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../../../lib/auth";

import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";

const context = { params: Promise.resolve({ id: PRODUCT_ID }) };

function request(body: unknown, sameOrigin = true): Request {
  return new Request(`http://localhost/api/v1/products/sellables/${PRODUCT_ID}/variants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresProductStore).mockReturnValue({} as never);
  vi.mocked(application.registerProductVariant).mockResolvedValue({
    productVariantId: VARIANT_ID,
    created: true,
  });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/products/sellables/[id]/variants", () => {
  it("registers a variant of the product", async () => {
    const response = await POST(request({ code: "V1", sku: "S1", name: "V1" }), context);
    expect(response.status).toBe(200);
    expect(application.registerProductVariant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        productId: PRODUCT_ID,
        code: "V1",
        sku: "S1",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      productVariantId: VARIANT_ID,
      created: true,
    });
  });

  it("returns 403 cross-origin, 400 for a bad id or body", async () => {
    expect(
      (await POST(request({ code: "V1", sku: "S1", name: "V1" }, false), context)).status,
    ).toBe(403);
    expect((await POST(request({ code: "V1" }), context)).status).toBe(400);
    expect(
      (
        await POST(request({ code: "V1", sku: "S1", name: "V1" }), {
          params: Promise.resolve({ id: "nope" }),
        })
      ).status,
    ).toBe(400);
    expect(application.registerProductVariant).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.registerProductVariant).mockRejectedValue(
      new DomainError("SKU already registered for this organization"),
    );
    const response = await POST(request({ code: "V1", sku: "S1", name: "V1" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "SKU already registered for this organization",
    });
  });
});
