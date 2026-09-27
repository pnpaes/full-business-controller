import type { PayrollReportRecord, UserAccess } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aquarela/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aquarela/application")>();
  return {
    ...actual,
    // The application slice is authored in parallel; pin the page default the
    // shared row module reads so this suite does not depend on its arrival.
    DEFAULT_PAYROLL_REPORT_LIMIT: 50,
    createPostgresSchedulingStore: vi.fn(() => ({})),
    listPayrollReports: vi.fn(),
    generatePayrollReport: vi.fn(),
    loadUserAccess: vi.fn(),
  };
});

vi.mock("../../../../../lib/auth", () => ({
  requireSession: vi.fn(),
  getAuthStore: vi.fn(() => ({})),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: vi.fn(() => ({ db: {} })) }));
vi.mock("../../../../../lib/jobs", () => ({ enqueuePayrollReportGeneration: vi.fn() }));
vi.mock("../../../../../lib/organization", () => ({ resolveOrganization: vi.fn(() => "org-1") }));
vi.mock("../../../../../lib/server-session", () => ({ getServerSession: vi.fn() }));

import * as application from "@aquarela/application";

import { requireSession } from "../../../../../lib/auth";
import { AuthHttpError } from "../../../../../lib/errors";
import { enqueuePayrollReportGeneration } from "../../../../../lib/jobs";
import { getServerSession } from "../../../../../lib/server-session";

import { parseGeneratePayrollReportBody, parsePayrollReportListQuery } from "../workforce-rows";

import { GET, POST } from "./route";

const ORG = "org-1";
const USER = "user-1";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "77777777-7777-4777-8777-777777777777";
const PERIOD_START = "2026-03-01";
const PERIOD_END = "2026-04-01";
const PATH = "/api/v1/workforce/payroll-reports";

function reportRecord(overrides: Partial<PayrollReportRecord> = {}): PayrollReportRecord {
  return {
    id: REPORT_ID,
    organizationId: ORG,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    generatedAt: "2026-03-29T09:00:00.000Z",
    generatedBy: USER,
    status: "generated",
    snapshot: { lines: [] },
    exportFileId: null,
    createdAt: "2026-03-29T09:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<PayrollReportRecord> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = { ...reportRecord(overrides) };
  delete record.organizationId;
  return record;
}

function access(roles: readonly string[], locationIds: readonly string[] = []): UserAccess {
  return { roles, locationIds };
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`);
}

function postRequest(body: unknown, query = ""): Request {
  return new Request(`http://localhost${PATH}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(application.createPostgresSchedulingStore).mockReturnValue({} as never);
  vi.mocked(application.listPayrollReports).mockResolvedValue([]);
  vi.mocked(application.generatePayrollReport).mockResolvedValue(reportRecord());
  vi.mocked(application.loadUserAccess).mockResolvedValue(access(["owner"]));
  vi.mocked(enqueuePayrollReportGeneration).mockResolvedValue({ jobId: JOB_ID });
  vi.mocked(getServerSession).mockResolvedValue({ userId: USER } as never);
  vi.mocked(requireSession).mockResolvedValue({
    session: { userId: USER },
    token: "token",
  } as never);
});

describe("GET /api/v1/workforce/payroll-reports", () => {
  it("lists the organization's payroll reports", async () => {
    vi.mocked(application.listPayrollReports).mockResolvedValue([reportRecord()]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      limit: 50,
      offset: 0,
      rows: [row()],
    });
    expect(application.listPayrollReports).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, limit: 50, offset: 0 }),
    );
  });

  it("passes the status, periodStartFrom and paging filters through", async () => {
    const response = await GET(
      getRequest("?status=exported&periodStartFrom=2026-01-01&limit=10&offset=5"),
    );

    expect(response.status).toBe(200);
    expect(application.listPayrollReports).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        status: "exported",
        periodStartFrom: "2026-01-01",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to read payroll-input reports",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(application.listPayrollReports).toHaveBeenCalled();
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not read payroll-input reports",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await GET(getRequest());

      expect(response.status).toBe(403);
      expect(application.listPayrollReports).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(undefined);

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(application.listPayrollReports).not.toHaveBeenCalled();
  });

  it("returns 400 for a status outside the vocabulary", async () => {
    const response = await GET(getRequest("?status=bogus"));

    expect(response.status).toBe(400);
    expect(application.listPayrollReports).not.toHaveBeenCalled();
  });

  it.each(["2026-03-01T00:00:00Z", "2026-3-1", "2026-13-01", "not-a-date"])(
    "returns 400 for the malformed periodStartFrom %j",
    async (periodStartFrom) => {
      const response = await GET(
        getRequest(`?periodStartFrom=${encodeURIComponent(periodStartFrom)}`),
      );

      expect(response.status).toBe(400);
      expect(application.listPayrollReports).not.toHaveBeenCalled();
    },
  );

  it.each(["?limit=0", "?limit=201", "?offset=201", "?offset=999999999999", "?limit=abc"])(
    "returns 400 for the out-of-range paging %j",
    async (query) => {
      const response = await GET(getRequest(query));

      expect(response.status).toBe(400);
      expect(application.listPayrollReports).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/v1/workforce/payroll-reports", () => {
  it("generates a report for the session actor and served organization", async () => {
    const response = await POST(postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }));

    expect(response.status).toBe(200);
    expect(application.generatePayrollReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        actorId: USER,
      }),
    );
    await expect(response.json()).resolves.toEqual({ ok: true, payrollReport: row() });
  });

  it.each(["owner", "general_manager", "finance", "admin"])(
    "allows %s to generate a report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(
        postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
      );

      expect(response.status).toBe(200);
      expect(application.generatePayrollReport).toHaveBeenCalled();
    },
  );

  it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
    "returns 403 for %s, which may not generate a report",
    async (role) => {
      vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

      const response = await POST(
        postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
      );

      expect(response.status).toBe(403);
      expect(application.generatePayrollReport).not.toHaveBeenCalled();
    },
  );

  it.each([
    { periodStart: PERIOD_END, periodEnd: PERIOD_START },
    { periodStart: PERIOD_START, periodEnd: PERIOD_START },
    { periodStart: PERIOD_START },
    { periodStart: "2026-03-01T00:00:00.000Z", periodEnd: PERIOD_END },
    { periodStart: "2026-13-01", periodEnd: PERIOD_END },
    {},
  ])("returns 400 for the malformed body %j", async (body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(application.generatePayrollReport).not.toHaveBeenCalled();
  });

  it("returns 401 for a mutation when signed out", async () => {
    vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

    const response = await POST(postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }));

    expect(response.status).toBe(401);
    expect(application.generatePayrollReport).not.toHaveBeenCalled();
  });

  it("maps a DomainError to 400 with its message", async () => {
    vi.mocked(application.generatePayrollReport).mockRejectedValue(
      new DomainError("period is not a calendar month"),
    );

    const response = await POST(postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "period is not a calendar month" });
  });

  it("maps a typed NotFoundError to 404", async () => {
    vi.mocked(application.generatePayrollReport).mockRejectedValue(
      new NotFoundError("no employees in organization"),
    );

    const response = await POST(postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }));

    expect(response.status).toBe(404);
  });

  describe("async mode", () => {
    it("enqueues and returns 202 with Location when ?async=true", async () => {
      const response = await POST(
        postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, "?async=true"),
      );

      expect(response.status).toBe(202);
      expect(response.headers.get("Location")).toBe(`/api/v1/jobs/${JOB_ID}`);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        jobId: JOB_ID,
        jobUrl: `/api/v1/jobs/${JOB_ID}`,
      });
      expect(enqueuePayrollReportGeneration).toHaveBeenCalledWith({
        organizationId: ORG,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
      expect(application.generatePayrollReport).not.toHaveBeenCalled();
    });

    it.each(["", "?async=false"])(
      "still generates synchronously and returns 200 with %j",
      async (query) => {
        const response = await POST(
          postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, query),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true, payrollReport: row() });
        expect(application.generatePayrollReport).toHaveBeenCalled();
        expect(enqueuePayrollReportGeneration).not.toHaveBeenCalled();
      },
    );

    it.each(["?async=1", "?async=yes", "?async="])(
      "returns 400 for the invalid async flag %j",
      async (query) => {
        const response = await POST(
          postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, query),
        );

        expect(response.status).toBe(400);
        expect(application.generatePayrollReport).not.toHaveBeenCalled();
        expect(enqueuePayrollReportGeneration).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, {}, { periodStart: PERIOD_START }])(
      "returns 400 for the malformed body %j in async mode",
      async (body) => {
        const response = await POST(postRequest(body, "?async=true"));

        expect(response.status).toBe(400);
        expect(enqueuePayrollReportGeneration).not.toHaveBeenCalled();
        expect(application.generatePayrollReport).not.toHaveBeenCalled();
      },
    );

    it.each(["location_manager", "kitchen", "front_of_house", "purchasing", "analyst"])(
      "returns 403 for %s in async mode",
      async (role) => {
        vi.mocked(application.loadUserAccess).mockResolvedValue(access([role]));

        const response = await POST(
          postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, "?async=true"),
        );

        expect(response.status).toBe(403);
        expect(enqueuePayrollReportGeneration).not.toHaveBeenCalled();
      },
    );

    it("returns 401 for an async mutation when signed out", async () => {
      vi.mocked(requireSession).mockRejectedValue(new AuthHttpError(401));

      const response = await POST(
        postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, "?async=true"),
      );

      expect(response.status).toBe(401);
      expect(enqueuePayrollReportGeneration).not.toHaveBeenCalled();
    });

    it("maps an enqueue DomainError to 400 with its message", async () => {
      vi.mocked(enqueuePayrollReportGeneration).mockRejectedValue(
        new DomainError("payload must be an object"),
      );

      const response = await POST(
        postRequest({ periodStart: PERIOD_START, periodEnd: PERIOD_END }, "?async=true"),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "payload must be an object" });
    });
  });
});

describe("parsePayrollReportListQuery", () => {
  it("parses the optional status/periodStartFrom filters and paging", () => {
    const parsed = parsePayrollReportListQuery(
      new URLSearchParams({
        status: "draft",
        periodStartFrom: PERIOD_START,
        limit: "25",
        offset: "2",
      }),
    );

    expect(parsed.ok && parsed.query).toEqual({
      status: "draft",
      periodStartFrom: PERIOD_START,
      limit: 25,
      offset: 2,
    });
  });

  it("defaults the page to the application limit and offset 0", () => {
    const parsed = parsePayrollReportListQuery(new URLSearchParams());

    expect(parsed.ok && parsed.query).toEqual({ limit: 50, offset: 0 });
  });

  it.each([
    new URLSearchParams({ status: "bogus" }),
    new URLSearchParams({ status: "" }),
    new URLSearchParams({ periodStartFrom: "2026-13-01" }),
    new URLSearchParams({ periodStartFrom: "2026-03-01T00:00:00Z" }),
    new URLSearchParams({ limit: "0" }),
    new URLSearchParams({ limit: "201" }),
    new URLSearchParams({ offset: "201" }),
    new URLSearchParams({ limit: "-1" }),
  ])("rejects the malformed query %j", (searchParams) => {
    expect(parsePayrollReportListQuery(searchParams).ok).toBe(false);
  });
});

describe("parseGeneratePayrollReportBody", () => {
  it("parses an ordered period", () => {
    const parsed = parseGeneratePayrollReportBody({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(parsed.ok && parsed.input).toEqual({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
  });

  it.each([
    undefined,
    {},
    { periodStart: PERIOD_START },
    { periodEnd: PERIOD_END },
    { periodStart: PERIOD_END, periodEnd: PERIOD_START },
    { periodStart: PERIOD_START, periodEnd: PERIOD_START },
    { periodStart: "2026-02-30", periodEnd: PERIOD_END },
    { periodStart: 20260301, periodEnd: PERIOD_END },
  ])("rejects the malformed body %j", (body) => {
    expect(parseGeneratePayrollReportBody(body as Record<string, unknown> | undefined).ok).toBe(
      false,
    );
  });
});
