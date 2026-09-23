import type { UserAccess } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    createPostgresCostingReadStore: vi.fn(() => ({})),
    createPostgresCostingStore: vi.fn(() => ({})),
    registerChannelFeeRule: vi.fn(),
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

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const TAX_RULE = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";
const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function readStoreStub() {
  return {
    findProductVariant: vi.fn(async () => undefined),
    findLocation: vi.fn(async () => undefined),
    findChannel: vi.fn(async () => ({
      id: CHANNEL,
      organizationId: ORG,
      code: "DEMO_ONLINE",
      name: "Demo Online",
    })),
    findCostCenter: vi.fn(async () => undefined),
    findItem: vi.fn(async () => undefined),
    findUnit: vi.fn(async () => undefined),
  };
}

const validBody = {
  channelId: CHANNEL,
  feeKind: "commission_pct",
  feeBasis: "net_price",
  percentageRate: "0.025000",
  effectiveFrom: EFFECTIVE_FROM,
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/costing/channel-fee-rules", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresCostingReadStore).mockReturnValue(readStoreStub() as never);
  vi.mocked(application.createPostgresCostingStore).mockReturnValue({} as never);
  vi.mocked(application.registerChannelFeeRule).mockResolvedValue({ channelFeeRuleId: RULE_ID });
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(getDb).mockReturnValue({ db: {} } as never);
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
});

describe("POST /api/v1/costing/channel-fee-rules", () => {
  it("registers a channel fee rule for the session actor", async () => {
    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(200);
    expect(application.registerChannelFeeRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        actorId: USER,
        channelId: CHANNEL,
        feeKind: "commission_pct",
        feeBasis: "net_price",
        percentageRate: "0.025000",
        taxRuleId: null,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, channelFeeRuleId: RULE_ID });
  });

  it("passes a nullable tax rule id through", async () => {
    const response = await POST(postRequest({ ...validBody, taxRuleId: TAX_RULE }));

    expect(response.status).toBe(200);
    expect(application.registerChannelFeeRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taxRuleId: TAX_RULE }),
    );
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(401);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside the costing write set", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(403);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("checks the role before parsing the body (session → role → parse)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["finance"]));

    const response = await POST(postRequest({}));

    expect(response.status).toBe(403);
  });

  it("returns 403 for a cross-origin request", async () => {
    const request = new Request("http://localhost/api/v1/costing/channel-fee-rules", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing fee basis", async () => {
    const response = await POST(postRequest({ ...validBody, feeBasis: undefined }));

    expect(response.status).toBe(400);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid channel", async () => {
    const response = await POST(postRequest({ ...validBody, channelId: "nope" }));

    expect(response.status).toBe(400);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("returns 400 when a rate field is present as a number", async () => {
    const response = await POST(postRequest({ ...validBody, percentageRate: 0.025 }));

    expect(response.status).toBe(400);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid tax rule id", async () => {
    const response = await POST(postRequest({ ...validBody, taxRuleId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(application.registerChannelFeeRule).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.registerChannelFeeRule).mockRejectedValue(
      new DomainError("unknown fee kind: bogus"),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "unknown fee kind: bogus" });
  });
});

describe("GET /api/v1/costing/channel-fee-rules", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 403 for a role with no costing access (front_of_house)", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["front_of_house"]));

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("returns the organization's channel fee rules with the channel name", async () => {
    vi.mocked(application.loadUserAccess).mockResolvedValue(access(["analyst"]));
    const findMany = vi.fn(async () => [
      {
        id: RULE_ID,
        organizationId: ORG,
        channelId: CHANNEL,
        feeKind: "commission_pct",
        percentageRate: "0.025000",
        fixedAmount: null,
        feeBasis: "net_price",
        taxRuleId: null,
        effectiveFrom: new Date(EFFECTIVE_FROM),
        effectiveTo: null,
      },
    ]);
    vi.mocked(getDb).mockReturnValue({
      db: { query: { channelFeeRule: { findMany } } },
    } as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      rows: [
        {
          id: RULE_ID,
          channelId: CHANNEL,
          channelName: "Demo Online",
          feeKind: "commission_pct",
          percentageRate: "0.025000",
          fixedAmount: null,
          feeBasis: "net_price",
          taxRuleId: null,
          effectiveFrom: EFFECTIVE_FROM,
          effectiveTo: null,
        },
      ],
    });
  });
});
