import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresProductStore: vi.fn(() => ({})),
    setAddonApplicability: vi.fn(),
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
const ADDON_ID = "11111111-1111-4111-8111-111111111111";
const BASE_ID = "22222222-2222-4222-8222-222222222222";

const context = { params: Promise.resolve({ id: ADDON_ID }) };

function request(body: unknown, sameOrigin = true): Request {
  return new Request(`http://localhost/api/v1/products/sellables/${ADDON_ID}/addon-applicability`, {
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
  vi.mocked(application.setAddonApplicability).mockResolvedValue({
    addonApplicabilityId: "addon-1",
    created: true,
  });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/products/sellables/[id]/addon-applicability", () => {
  it("sets the applicability with the path product as the add-on", async () => {
    const response = await POST(request({ baseProductId: BASE_ID, priceEffect: "2.5" }), context);
    expect(response.status).toBe(200);
    expect(application.setAddonApplicability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        addonProductId: ADDON_ID,
        baseProductId: BASE_ID,
        priceEffect: "2.5",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      addonApplicabilityId: "addon-1",
      created: true,
    });
  });

  it("returns 403 cross-origin, 400 for a bad id or body", async () => {
    expect((await POST(request({ baseProductId: BASE_ID }, false), context)).status).toBe(403);
    expect((await POST(request({ baseProductId: "nope" }), context)).status).toBe(400);
    expect(
      (await POST(request({ baseProductId: BASE_ID }), { params: Promise.resolve({ id: "nope" }) }))
        .status,
    ).toBe(400);
    expect(application.setAddonApplicability).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.setAddonApplicability).mockRejectedValue(
      new DomainError("a product cannot be its own add-on"),
    );
    const response = await POST(request({ baseProductId: ADDON_ID }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "a product cannot be its own add-on",
    });
  });
});
