import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresMasterDataStore: vi.fn(() => ({})),
    registerUnitConversion: vi.fn(),
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

import { POST } from "./route";
import { parseRegisterUnitConversionBody } from "./unit-conversion-body";

const ORG = "org-1";
const USER = "user-1";
const CONVERSION_ID = "33333333-3333-4333-8333-333333333333";

function postRequest(body: unknown, sameOrigin = true): Request {
  return new Request("http://localhost/api/v1/products/unit-conversions", {
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
  vi.mocked(application.registerUnitConversion).mockResolvedValue({
    conversionId: CONVERSION_ID,
  });
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("POST /api/v1/products/unit-conversions", () => {
  it("registers a global conversion for the session actor and organization", async () => {
    const response = await POST(
      postRequest({ fromUnitCode: "kg", toUnitCode: "g", factor: "1000" }),
    );

    expect(response.status).toBe(200);
    expect(application.registerUnitConversion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        fromUnitCode: "kg",
        toUnitCode: "g",
        factor: "1000",
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, conversionId: CONVERSION_ID });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    expect(
      (await POST(postRequest({ fromUnitCode: "kg", toUnitCode: "g", factor: "1" }))).status,
    ).toBe(401);
    expect(application.registerUnitConversion).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    expect(
      (await POST(postRequest({ fromUnitCode: "kg", toUnitCode: "g", factor: "1" }, false))).status,
    ).toBe(403);
    expect(application.registerUnitConversion).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or malformed field", async () => {
    expect((await POST(postRequest({ fromUnitCode: "kg", toUnitCode: "g" }))).status).toBe(400);
    expect(
      (await POST(postRequest({ fromUnitCode: "kg", toUnitCode: "g", factor: "1e3" }))).status,
    ).toBe(400);
    expect(application.registerUnitConversion).not.toHaveBeenCalled();
  });

  it("maps a command DomainError to 400 with its message", async () => {
    vi.mocked(application.registerUnitConversion).mockRejectedValue(
      new DomainError("a conversion for this unit pair is already effective"),
    );

    const response = await POST(
      postRequest({ fromUnitCode: "kg", toUnitCode: "g", factor: "1000" }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "a conversion for this unit pair is already effective",
    });
  });
});

describe("parseRegisterUnitConversionBody", () => {
  it("accepts a decimal factor and trims the codes", () => {
    expect(
      parseRegisterUnitConversionBody({ fromUnitCode: " kg ", toUnitCode: "g", factor: "0.001" }),
    ).toEqual({ ok: true, input: { fromUnitCode: "kg", toUnitCode: "g", factor: "0.001" } });
  });

  it("rejects a missing field, a scientific factor and a non-object body", () => {
    expect(parseRegisterUnitConversionBody({ fromUnitCode: "kg", factor: "1" })).toEqual({
      ok: false,
    });
    expect(
      parseRegisterUnitConversionBody({ fromUnitCode: "kg", toUnitCode: "g", factor: "1e3" }),
    ).toEqual({ ok: false });
    expect(parseRegisterUnitConversionBody(undefined)).toEqual({ ok: false });
  });
});
