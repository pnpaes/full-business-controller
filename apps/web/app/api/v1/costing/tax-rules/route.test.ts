import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostingReadStore: vi.fn(() => ({})),
    createPostgresTaxStore: vi.fn(() => ({})),
    createTaxRule: vi.fn(),
    supersedeTaxRule: vi.fn(),
    listTaxRules: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { getServerSession } from "../../../../../lib/server-session";

import { POST as POST_SUPERSEDE } from "./[id]/supersede/route";
import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const RULE_ID = "11111111-1111-4111-8111-111111111111";
const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

function access(roles: readonly string[]): UserAccess {
  return { roles, locationIds: [] };
}

const validBody = {
  code: "NO_VAT_FOOD",
  name: "Food 15%",
  ratePct: "0.150000",
  taxBasis: "inclusive",
  taxTreatment: "channel_overridable",
  appliesTo: "product",
  effectiveFrom: EFFECTIVE_FROM,
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/costing/tax-rules", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCostingReadStore).mockReturnValue({} as never);
  vi.mocked(application.createPostgresTaxStore).mockReturnValue({} as never);
  vi.mocked(application.createTaxRule).mockResolvedValue({ taxRuleId: RULE_ID });
  vi.mocked(application.supersedeTaxRule).mockResolvedValue({
    taxRuleId: RULE_ID,
    effectiveTo: "2026-06-01T00:00:00.000Z",
  });
  vi.mocked(application.listTaxRules).mockResolvedValue([]);
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getDb).mockReturnValue({ db: {} } as never);
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("POST /api/v1/costing/tax-rules", () => {
  it("creates the rule for the session actor and organization", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.createTaxRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        code: "NO_VAT_FOOD",
        name: "Food 15%",
        ratePct: "0.150000",
        taxBasis: "inclusive",
        taxTreatment: "channel_overridable",
        recoverable: false,
        appliesTo: "product",
        locationId: null,
        channelId: null,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, taxRuleId: RULE_ID });
  });

  it("passes the scope, window and recoverable flag through", async () => {
    const channelId = "22222222-2222-4222-8222-222222222222";
    const response = await POST(
      postRequest({
        ...validBody,
        scopeType: "channel",
        channelId,
        recoverable: true,
        effectiveTo: "2026-06-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(application.createTaxRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopeType: "channel",
        channelId,
        recoverable: true,
        effectiveTo: "2026-06-01T00:00:00.000Z",
      }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.createTaxRule).not.toHaveBeenCalled();
  });

  it("returns 403 for a read-only role", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.createTaxRule).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing field, a malformed scope id or a malformed optional value", async () => {
    const missing = await POST(postRequest({ ...validBody, ratePct: undefined }));
    expect(missing.status).toBe(400);

    const badScope = await POST(
      postRequest({ ...validBody, scopeType: "channel", channelId: "nope" }),
    );
    expect(badScope.status).toBe(400);

    const numericScope = await POST(postRequest({ ...validBody, channelId: 42 }));
    expect(numericScope.status).toBe(400);

    const badRecoverable = await POST(postRequest({ ...validBody, recoverable: "yes" }));
    expect(badRecoverable.status).toBe(400);
  });

  it("maps a command DomainError (duplicate/overlap/enum) to 400 with its message", async () => {
    vi.mocked(application.createTaxRule).mockRejectedValue(
      new DomainError('tax rule "FIRST" is already effective over this window'),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'tax rule "FIRST" is already effective over this window',
    });
  });
});

describe("POST /api/v1/costing/tax-rules/[id]/supersede", () => {
  function supersedeRequest(body: unknown): Request {
    return new Request(`http://localhost/api/v1/costing/tax-rules/${RULE_ID}/supersede`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(body),
    });
  }

  function context(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("ends the rule for the session actor", async () => {
    const response = await POST_SUPERSEDE(
      supersedeRequest({ effectiveTo: "2026-06-01T00:00:00.000Z" }),
      context(RULE_ID),
    );

    expect(response.status).toBe(200);
    expect(application.supersedeTaxRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        taxRuleId: RULE_ID,
        effectiveTo: "2026-06-01T00:00:00.000Z",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      taxRuleId: RULE_ID,
      effectiveTo: "2026-06-01T00:00:00.000Z",
    });
  });

  it("returns 400 for a malformed id, a missing body or a cross-org rule", async () => {
    const badId = await POST_SUPERSEDE(
      supersedeRequest({ effectiveTo: "2026-06-01T00:00:00.000Z" }),
      context("not-a-uuid"),
    );
    expect(badId.status).toBe(400);
    expect(application.supersedeTaxRule).not.toHaveBeenCalled();

    const badBody = await POST_SUPERSEDE(supersedeRequest({}), context(RULE_ID));
    expect(badBody.status).toBe(400);

    vi.mocked(application.supersedeTaxRule).mockRejectedValue(
      new DomainError("tax rule not found in organization"),
    );
    const crossOrg = await POST_SUPERSEDE(
      supersedeRequest({ effectiveTo: "2026-06-01T00:00:00.000Z" }),
      context(RULE_ID),
    );
    expect(crossOrg.status).toBe(400);
  });

  it("returns 401 when signed out and 403 for a read-only role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    const signedOut = await POST_SUPERSEDE(
      supersedeRequest({ effectiveTo: "2026-06-01T00:00:00.000Z" }),
      context(RULE_ID),
    );
    expect(signedOut.status).toBe(401);

    vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["general_manager"]));
    const forbidden = await POST_SUPERSEDE(
      supersedeRequest({ effectiveTo: "2026-06-01T00:00:00.000Z" }),
      context(RULE_ID),
    );
    expect(forbidden.status).toBe(403);
    expect(application.supersedeTaxRule).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/costing/tax-rules", () => {
  it("still returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
