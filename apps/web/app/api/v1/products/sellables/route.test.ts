import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductStore: vi.fn(() => ({})),
    listProducts: vi.fn(),
    registerProduct: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({
  resolveOrganization: vi.fn(() => "org-1"),
}));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../lib/auth";
import { getServerSession } from "../../../../../lib/server-session";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

function postRequest(body: unknown, sameOrigin = true): Request {
  return new Request("http://localhost/api/v1/products/sellables", {
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
  vi.mocked(application.listProducts).mockResolvedValue([]);
  vi.mocked(application.registerProduct).mockResolvedValue({
    productId: PRODUCT_ID,
    created: true,
  });
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/products/sellables", () => {
  it("returns the org's products with their variants", async () => {
    vi.mocked(application.listProducts).mockResolvedValue([
      {
        product: {
          id: PRODUCT_ID,
          organizationId: ORG,
          code: "CAKE",
          name: "Cake",
          category: null,
          productKind: "base",
          activeFrom: "2026-01-01",
          activeTo: null,
        },
        variants: [],
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      products: [
        {
          product: {
            id: PRODUCT_ID,
            code: "CAKE",
            name: "Cake",
            category: null,
            productKind: "base",
            activeFrom: "2026-01-01",
            activeTo: null,
          },
          variants: [],
        },
      ],
    });
    expect(application.listProducts).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
    });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    expect((await GET()).status).toBe(401);
  });
});

describe("POST /api/v1/products/sellables", () => {
  it("registers a product for the session actor and organization", async () => {
    const response = await POST(postRequest({ code: "CAKE", name: "Cake", productKind: "base" }));

    expect(response.status).toBe(200);
    expect(application.registerProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, actorId: USER, code: "CAKE", name: "Cake" }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      productId: PRODUCT_ID,
      created: true,
    });
  });

  it("returns 403 for a cross-origin request", async () => {
    expect((await POST(postRequest({ code: "X", name: "X" }, false))).status).toBe(403);
    expect(application.registerProduct).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing field or an unknown kind", async () => {
    expect((await POST(postRequest({ code: "X" }))).status).toBe(400);
    expect((await POST(postRequest({ code: "X", name: "X", productKind: "bundle" }))).status).toBe(
      400,
    );
    expect(application.registerProduct).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.registerProduct).mockRejectedValue(
      new DomainError("product name must not be empty"),
    );
    const response = await POST(postRequest({ code: "X", name: "X" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "product name must not be empty" });
  });
});
