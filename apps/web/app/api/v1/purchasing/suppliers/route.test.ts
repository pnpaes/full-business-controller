import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresMasterDataStore: vi.fn(() => ({})),
    registerSupplier: vi.fn(),
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
import { AuthHttpError } from "../../../../../lib/errors";

import { parseRegisterSupplierBody } from "./supplier-body";
import { POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";

function postRequest(body: unknown, sameOrigin = true): Request {
  return new Request("http://localhost/api/v1/purchasing/suppliers", {
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
  vi.mocked(application.createPostgresMasterDataStore).mockReturnValue({} as never);
  vi.mocked(application.registerSupplier).mockResolvedValue({
    supplierId: SUPPLIER_ID,
    created: true,
  });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/purchasing/suppliers", () => {
  it("registers a supplier for the session actor and served organization", async () => {
    const response = await POST(
      postRequest({ code: "SUP-1", name: "Nordkaffe", contact: "hi@example.com" }),
    );

    expect(response.status).toBe(200);
    expect(application.registerSupplier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        code: "SUP-1",
        name: "Nordkaffe",
        contact: "hi@example.com",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      supplierId: SUPPLIER_ID,
      created: true,
    });
  });

  it("passes an idempotent re-run's created flag through", async () => {
    vi.mocked(application.registerSupplier).mockResolvedValue({
      supplierId: SUPPLIER_ID,
      created: false,
    });

    const response = await POST(postRequest({ code: "SUP-1", name: "Nordkaffe" }));
    await expect(response.json()).resolves.toMatchObject({ created: false });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    expect((await POST(postRequest({ code: "SUP-1", name: "x" }))).status).toBe(401);
    expect(application.registerSupplier).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    expect((await POST(postRequest({ code: "SUP-1", name: "x" }, false))).status).toBe(403);
    expect(application.registerSupplier).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing code or name, or a bad currency", async () => {
    expect((await POST(postRequest({ name: "x" }))).status).toBe(400);
    expect((await POST(postRequest({ code: "SUP-1" }))).status).toBe(400);
    expect((await POST(postRequest({ code: "SUP-1", name: "x", currency: "us" }))).status).toBe(
      400,
    );
    expect(application.registerSupplier).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.registerSupplier).mockRejectedValue(
      new DomainError("supplier code must not be empty"),
    );

    const response = await POST(postRequest({ code: "SUP-1", name: "x" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "supplier code must not be empty" });
  });
});

describe("parseRegisterSupplierBody", () => {
  it("trims text and omits absent optionals", () => {
    expect(parseRegisterSupplierBody({ code: "  SUP-1 ", name: " Nord ", contact: "  " })).toEqual({
      ok: true,
      input: { code: "SUP-1", name: "Nord" },
    });
  });

  it("uppercases nothing but validates the currency shape", () => {
    expect(parseRegisterSupplierBody({ code: "S", name: "N", currency: "eur" })).toEqual({
      ok: true,
      input: { code: "S", name: "N", currency: "eur" },
    });
    expect(parseRegisterSupplierBody({ code: "S", name: "N", currency: "euro" })).toEqual({
      ok: false,
    });
    expect(parseRegisterSupplierBody(undefined)).toEqual({ ok: false });
  });
});
