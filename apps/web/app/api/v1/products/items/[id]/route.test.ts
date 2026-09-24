import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresMasterDataStore: vi.fn(() => ({})),
    getItem: vi.fn(),
    updateItem: vi.fn(),
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
import { AuthHttpError } from "../../../../../../lib/errors";

import { parseUpdateItemBody } from "../../item-body";
import { PATCH } from "./route";

const ORG = "org-1";
const USER = "user-1";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function patchRequest(body: unknown, sameOrigin = true): Request {
  return new Request(`http://localhost/api/v1/products/items/${ITEM_ID}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function context(id: string): { readonly params: Promise<{ readonly id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresMasterDataStore).mockReturnValue({} as never);
  vi.mocked(application.updateItem).mockResolvedValue({ itemId: ITEM_ID });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("PATCH /api/v1/products/items/[id]", () => {
  it("updates the mutable fields for the session actor and served organization", async () => {
    const response = await PATCH(
      patchRequest({ name: "Wheat flour", inventoryPolicy: "non_stock", lotTracked: true }),
      context(ITEM_ID),
    );

    expect(response.status).toBe(200);
    expect(application.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        itemId: ITEM_ID,
        name: "Wheat flour",
        inventoryPolicy: "non_stock",
        lotTracked: true,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, itemId: ITEM_ID });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await PATCH(patchRequest({ name: "x" }), context(ITEM_ID));
    expect(response.status).toBe(401);
    expect(application.updateItem).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await PATCH(patchRequest({ name: "x" }, false), context(ITEM_ID));
    expect(response.status).toBe(403);
    expect(application.updateItem).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    const response = await PATCH(patchRequest({ name: "x" }), context("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(application.updateItem).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty or unknown-only body", async () => {
    expect((await PATCH(patchRequest({}), context(ITEM_ID))).status).toBe(400);
    expect((await PATCH(patchRequest({ code: "NEW" }), context(ITEM_ID))).status).toBe(400);
    expect(application.updateItem).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.updateItem).mockRejectedValue(
      new DomainError("item not found in organization"),
    );

    const response = await PATCH(patchRequest({ name: "x" }), context(ITEM_ID));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "item not found in organization" });
  });
});

describe("parseUpdateItemBody", () => {
  it("accepts each mutable field and trims the name", () => {
    expect(parseUpdateItemBody({ name: "  Flour  " })).toEqual({
      ok: true,
      input: { name: "Flour" },
    });
    expect(parseUpdateItemBody({ lotTracked: false })).toEqual({
      ok: true,
      input: { lotTracked: false },
    });
  });

  it("rejects an empty body, a blank name, a bad policy and a non-boolean flag", () => {
    expect(parseUpdateItemBody({})).toEqual({ ok: false });
    expect(parseUpdateItemBody({ name: "  " })).toEqual({ ok: false });
    expect(parseUpdateItemBody({ inventoryPolicy: "not_a_policy" })).toEqual({ ok: false });
    expect(parseUpdateItemBody({ lotTracked: "yes" })).toEqual({ ok: false });
    expect(parseUpdateItemBody(undefined)).toEqual({ ok: false });
  });
});
