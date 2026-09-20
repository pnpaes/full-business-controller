import type { ReconciliationRecord } from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  parseReconcileImportRunBody,
  parseReconcileSettlementBody,
  parseReconciliationListQuery,
  parseResolveReconciliationBody,
  toReconciliationRows,
} from "./reconciliation-rows";

const ORG = "org-1";
const OTHER = "org-2";
const SCOPE = "11111111-1111-4111-8111-111111111111";
const SETTLEMENT = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

function record(overrides: Partial<ReconciliationRecord> = {}): ReconciliationRecord {
  return {
    id: "rec-1",
    organizationId: ORG,
    scopeType: "import_run",
    scopeId: SCOPE,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    expectedAmount: "555.0000",
    actualAmount: "555.0000",
    tolerance: "5.0000",
    difference: "0.0000",
    status: "within_tolerance",
    resolutionNote: null,
    ownerId: null,
    dueDate: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

describe("parseReconciliationListQuery", () => {
  it("defaults the page and leaves the filters unset", () => {
    expect(parseReconciliationListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
  });

  it("accepts a vocabulary status, a scope type and a scope id", () => {
    expect(
      parseReconciliationListQuery(
        new URLSearchParams({ status: "exception", scopeType: "import_run", scopeId: SCOPE }),
      ),
    ).toEqual({
      ok: true,
      query: { status: "exception", scopeType: "import_run", scopeId: SCOPE, limit: 50, offset: 0 },
    });
  });

  it("rejects an unknown status, a malformed scope id and an out-of-range limit", () => {
    expect(parseReconciliationListQuery(new URLSearchParams({ status: "nope" })).ok).toBe(false);
    expect(parseReconciliationListQuery(new URLSearchParams({ scopeId: "nope" })).ok).toBe(false);
    expect(parseReconciliationListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseReconciliationListQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
  });
});

describe("parseReconcileImportRunBody", () => {
  it("requires an explicit tolerance or an explicit DEC-026 default opt-in", () => {
    expect(parseReconcileImportRunBody({})).toEqual({ ok: false });
    expect(parseReconcileImportRunBody({ tolerance: "5.0000" })).toEqual({
      ok: true,
      input: {
        scopeType: null,
        tolerance: "5.0000",
        useDecisionDefaultTolerance: false,
        ownerId: null,
        dueDate: null,
      },
    });
    expect(parseReconcileImportRunBody({ useDecisionDefaultTolerance: true })).toMatchObject({
      ok: true,
      input: { tolerance: null, useDecisionDefaultTolerance: true },
    });
  });

  it("rejects a negative tolerance, a bad owner id, a bad due date and a bad flag", () => {
    expect(parseReconcileImportRunBody({ tolerance: "-1" }).ok).toBe(false);
    expect(parseReconcileImportRunBody({ tolerance: "abc" }).ok).toBe(false);
    expect(
      parseReconcileImportRunBody({ useDecisionDefaultTolerance: true, ownerId: "nope" }).ok,
    ).toBe(false);
    expect(
      parseReconcileImportRunBody({ useDecisionDefaultTolerance: true, dueDate: "01-08-2026" }).ok,
    ).toBe(false);
    expect(parseReconcileImportRunBody({ useDecisionDefaultTolerance: "yes" }).ok).toBe(false);
  });

  it("passes through a scope type, owner and due date", () => {
    expect(
      parseReconcileImportRunBody({
        scopeType: " import_run ",
        tolerance: "1",
        ownerId: OWNER,
        dueDate: "2026-09-30",
      }),
    ).toEqual({
      ok: true,
      input: {
        scopeType: "import_run",
        tolerance: "1",
        useDecisionDefaultTolerance: false,
        ownerId: OWNER,
        dueDate: "2026-09-30",
      },
    });
  });
});

describe("parseReconcileSettlementBody", () => {
  it("requires a settlement id and the tolerance choice", () => {
    expect(parseReconcileSettlementBody({ useDecisionDefaultTolerance: true })).toEqual({
      ok: false,
    });
    expect(parseReconcileSettlementBody({ settlementId: "nope", tolerance: "1" })).toEqual({
      ok: false,
    });
    expect(
      parseReconcileSettlementBody({ settlementId: SETTLEMENT, useDecisionDefaultTolerance: true }),
    ).toEqual({
      ok: true,
      input: {
        settlementId: SETTLEMENT,
        scopeType: null,
        tolerance: null,
        useDecisionDefaultTolerance: true,
        ownerId: null,
        dueDate: null,
      },
    });
  });
});

describe("parseResolveReconciliationBody", () => {
  it("accepts a vocabulary status with an optional note", () => {
    expect(
      parseResolveReconciliationBody({ status: "approved", resolutionNote: " matched " }),
    ).toEqual({
      ok: true,
      input: {
        status: "approved",
        resolutionNote: "matched",
        ownerId: null,
        dueDate: null,
      },
    });
    expect(parseResolveReconciliationBody({ status: "pending" })).toMatchObject({
      ok: true,
      input: { status: "pending", resolutionNote: null },
    });
  });

  it("rejects a missing/unknown status and a non-string note", () => {
    expect(parseResolveReconciliationBody({}).ok).toBe(false);
    expect(parseResolveReconciliationBody({ status: "closed" }).ok).toBe(false);
    expect(parseResolveReconciliationBody({ status: "pending", resolutionNote: 3 }).ok).toBe(false);
  });
});

describe("toReconciliationRows", () => {
  it("maps the row-12 fields and drops a foreign organization", () => {
    const rows = toReconciliationRows(ORG, [
      record(),
      record({ id: "rec-foreign", organizationId: OTHER }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "rec-1",
      scopeType: "import_run",
      expectedAmount: "555.0000",
      actualAmount: "555.0000",
      tolerance: "5.0000",
      difference: "0.0000",
      status: "within_tolerance",
      resolutionNote: null,
      updatedAt: null,
    });
  });
});
