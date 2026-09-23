import { describe, expect, it } from "vitest";

import { RECONCILED_RECONCILIATION_STATUSES, evaluateReversalGate } from "./reversal-gate";

const OPEN = {
  coveringReconciliationStatuses: [],
  locationLocked: false,
  companyLocked: false,
} as const;

describe("evaluateReversalGate", () => {
  it("mirrors the blocking reconciliation statuses", () => {
    expect(RECONCILED_RECONCILIATION_STATUSES).toEqual([
      "within_tolerance",
      "resolved",
      "approved",
    ]);
  });

  it("allows when nothing covers or locks the day", () => {
    expect(evaluateReversalGate(OPEN)).toEqual({ allowed: true, reason: null });
  });

  it("allows when the covering statuses are all non-blocking", () => {
    expect(
      evaluateReversalGate({ ...OPEN, coveringReconciliationStatuses: ["pending", "exception"] }),
    ).toEqual({ allowed: true, reason: null });
  });

  it("allows an empty covering status list (boundary)", () => {
    expect(evaluateReversalGate({ ...OPEN, coveringReconciliationStatuses: [] })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("allows when a covering status is outside the vocabulary", () => {
    expect(evaluateReversalGate({ ...OPEN, coveringReconciliationStatuses: ["bogus"] })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it.each(RECONCILED_RECONCILIATION_STATUSES)("blocks on a %s reconciliation", (status) => {
    const decision = evaluateReversalGate({
      ...OPEN,
      coveringReconciliationStatuses: [status],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(status);
  });

  it("names the blocking statuses once each, sorted", () => {
    const decision = evaluateReversalGate({
      ...OPEN,
      coveringReconciliationStatuses: ["approved", "resolved", "approved", "pending"],
    });
    expect(decision.reason).toBe(
      "cannot reverse a sales line in a reconciled period (approved, resolved)",
    );
  });

  it("blocks on a location lock", () => {
    const decision = evaluateReversalGate({ ...OPEN, locationLocked: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("location");
  });

  it("blocks on a company lock", () => {
    const decision = evaluateReversalGate({ ...OPEN, companyLocked: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("company");
  });

  it("reports the location lock ahead of a company lock", () => {
    const decision = evaluateReversalGate({ ...OPEN, locationLocked: true, companyLocked: true });
    expect(decision.reason).toContain("location");
  });

  it("reports a lock ahead of a reconciled reconciliation", () => {
    const decision = evaluateReversalGate({
      coveringReconciliationStatuses: ["approved"],
      locationLocked: false,
      companyLocked: true,
    });
    expect(decision.reason).toContain("company");
  });
});
