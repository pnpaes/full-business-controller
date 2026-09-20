import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  IMPORT_RUN_STATUSES,
  assertImportRunStatusTransition,
  canTransitionImportRunStatus,
  resolveExternalEntity,
  type ExternalMappingCandidate,
} from "./sales-mapping";

const A: ExternalMappingCandidate = { internalEntityId: "item-a" };
const B: ExternalMappingCandidate = { internalEntityId: "item-b" };

describe("resolveExternalEntity", () => {
  it("matches on SKU first (DEC-041)", () => {
    const result = resolveExternalEntity({
      sku: "COF-01",
      externalId: "ext-9",
      candidates: [
        { internalEntityId: "item-a", sku: "COF-01", externalId: "ext-1" },
        { internalEntityId: "item-b", sku: "TEA-01", externalId: "ext-9" },
      ],
    });
    expect(result).toEqual({ status: "matched", internalEntityId: "item-a", match: "sku" });
  });

  it("ignores surrounding whitespace when matching keys", () => {
    const result = resolveExternalEntity({
      sku: "  COF-01  ",
      candidates: [{ internalEntityId: "item-a", sku: "COF-01" }],
    });
    expect(result).toEqual({ status: "matched", internalEntityId: "item-a", match: "sku" });
  });

  it("falls back to the external id only when no SKU is present (DEC-041)", () => {
    const result = resolveExternalEntity({
      externalId: "ext-9",
      candidates: [
        { internalEntityId: "item-a", sku: "COF-01", externalId: "ext-1" },
        { internalEntityId: "item-b", sku: "TEA-01", externalId: "ext-9" },
      ],
    });
    expect(result).toEqual({ status: "matched", internalEntityId: "item-b", match: "external_id" });
  });

  it("does not fall back to the external id when a present SKU is unknown", () => {
    const result = resolveExternalEntity({
      sku: "UNKNOWN",
      externalId: "ext-9",
      candidates: [{ internalEntityId: "item-b", sku: "TEA-01", externalId: "ext-9" }],
    });
    expect(result).toEqual({ status: "unmapped", reason: "sku_not_found" });
  });

  it("reports unmapped when the external id has no candidate", () => {
    const result = resolveExternalEntity({
      externalId: "ext-missing",
      candidates: [{ internalEntityId: "item-a", externalId: "ext-1" }],
    });
    expect(result).toEqual({ status: "unmapped", reason: "external_id_not_found" });
  });

  it("reports unmapped when neither key is present or when there are no candidates", () => {
    expect(resolveExternalEntity({ candidates: [A, B] })).toEqual({
      status: "unmapped",
      reason: "no_key",
    });
    expect(resolveExternalEntity({ sku: "  ", externalId: "", candidates: [] })).toEqual({
      status: "unmapped",
      reason: "no_key",
    });
    expect(resolveExternalEntity({ sku: "COF-01", candidates: [] })).toEqual({
      status: "unmapped",
      reason: "sku_not_found",
    });
  });

  it("flags one SKU resolving to two internal entities (DEC-033)", () => {
    const result = resolveExternalEntity({
      sku: "COF-01",
      candidates: [
        { internalEntityId: "item-a", sku: "COF-01" },
        { internalEntityId: "item-b", sku: "COF-01" },
      ],
    });
    expect(result).toMatchObject({
      status: "conflict",
      kind: "ambiguous_sku",
      internalEntityIds: ["item-a", "item-b"],
    });
  });

  it("flags one external id resolving to two internal entities (DEC-033)", () => {
    const result = resolveExternalEntity({
      externalId: "ext-1",
      candidates: [
        { internalEntityId: "item-a", externalId: "ext-1" },
        { internalEntityId: "item-b", externalId: "ext-1" },
      ],
    });
    expect(result).toMatchObject({
      status: "conflict",
      kind: "external_id_to_many_internals",
      internalEntityIds: ["item-a", "item-b"],
      externalIds: ["ext-1"],
    });
  });

  it("flags two external ids resolving to one internal entity (DEC-033)", () => {
    const result = resolveExternalEntity({
      externalId: "ext-1",
      candidates: [
        { internalEntityId: "item-a", externalId: "ext-1" },
        { internalEntityId: "item-a", externalId: "ext-2" },
      ],
    });
    expect(result).toMatchObject({
      status: "conflict",
      kind: "internal_to_many_externals",
      internalEntityIds: ["item-a"],
      externalIds: ["ext-2"],
    });
  });

  it("does not treat an unrelated candidate as a conflict", () => {
    const result = resolveExternalEntity({
      externalId: "ext-1",
      candidates: [
        { internalEntityId: "item-a", externalId: "ext-1" },
        { internalEntityId: "item-b", externalId: "ext-2" },
      ],
    });
    expect(result).toEqual({ status: "matched", internalEntityId: "item-a", match: "external_id" });
  });
});

describe("import-run status transitions", () => {
  it("follows the documented workflow (05_WORKFLOWS.md §5.9)", () => {
    expect(canTransitionImportRunStatus("uploaded", "parsed")).toBe(true);
    expect(canTransitionImportRunStatus("parsed", "validated")).toBe(true);
    expect(canTransitionImportRunStatus("parsed", "needs_review")).toBe(true);
    expect(canTransitionImportRunStatus("needs_review", "validated")).toBe(true);
    expect(canTransitionImportRunStatus("validated", "needs_review")).toBe(true);
    expect(canTransitionImportRunStatus("failed", "parsed")).toBe(true);
  });

  it("rejects transitions that skip a state or leave a terminal state", () => {
    expect(canTransitionImportRunStatus("uploaded", "validated")).toBe(false);
    expect(canTransitionImportRunStatus("uploaded", "posted")).toBe(false);
    expect(canTransitionImportRunStatus("superseded", "parsed")).toBe(false);
    expect(canTransitionImportRunStatus("posted", "validated")).toBe(false);
    expect(canTransitionImportRunStatus("nonsense", "parsed")).toBe(false);
  });

  it("asserts transitions and surfaces the statuses it knows", () => {
    expect(() => assertImportRunStatusTransition("uploaded", "parsed")).not.toThrow();
    expect(() => assertImportRunStatusTransition("uploaded", "validated")).toThrow(DomainError);
    expect(IMPORT_RUN_STATUSES).toContain("partially_posted");
  });
});
