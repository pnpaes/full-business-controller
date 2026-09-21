import { describe, expect, it } from "vitest";

import { DomainError } from "@aquarela/domain";

import { parseImportValidationRules } from "./validation";

describe("parseImportValidationRules", () => {
  it("returns only the present, well-formed keys", () => {
    expect(
      parseImportValidationRules({
        requiredNormalizedFields: ["sku", "location_external_id"],
        expectedCurrency: "NOK",
        requireCurrency: true,
        allowedLocationExternalIds: ["loc-1"],
        requireOccurredAt: false,
        requireAmounts: true,
      }),
    ).toEqual({
      requiredNormalizedFields: ["sku", "location_external_id"],
      expectedCurrency: "NOK",
      requireCurrency: true,
      allowedLocationExternalIds: ["loc-1"],
      requireOccurredAt: false,
      requireAmounts: true,
    });
  });

  it("returns {} for an empty object and ignores unknown keys", () => {
    expect(parseImportValidationRules({})).toEqual({});
    expect(
      parseImportValidationRules({ futureRule: "x", requiredNormalizedFields: ["sku"] }),
    ).toEqual({ requiredNormalizedFields: ["sku"] });
  });

  it.each([null, undefined, [], ["sku"], "NOK", 7, true])(
    "rejects a non-object value (%p)",
    (value) => {
      expect(() => parseImportValidationRules(value)).toThrow(DomainError);
    },
  );

  it("trims list entries", () => {
    expect(
      parseImportValidationRules({
        requiredNormalizedFields: [" sku ", "\tlocation_external_id\n"],
        allowedLocationExternalIds: [" loc-1 "],
      }),
    ).toEqual({
      requiredNormalizedFields: ["sku", "location_external_id"],
      allowedLocationExternalIds: ["loc-1"],
    });
  });

  it.each([
    ["requiredNormalizedFields", "sku"],
    ["requiredNormalizedFields", [1, "sku"]],
    ["requiredNormalizedFields", ["", "sku"]],
    ["requiredNormalizedFields", ["  "]],
    ["allowedLocationExternalIds", "loc-1"],
    ["allowedLocationExternalIds", [null]],
    ["allowedLocationExternalIds", [" "]],
  ])("rejects a malformed list key %s = %p", (key, value) => {
    expect(() => parseImportValidationRules({ [key]: value })).toThrow(DomainError);
  });

  it.each([7, "", "   ", null, ["NOK"]])("rejects a malformed expectedCurrency (%p)", (value) => {
    expect(() => parseImportValidationRules({ expectedCurrency: value })).toThrow(DomainError);
  });

  it.each(["requireCurrency", "requireOccurredAt", "requireAmounts"])(
    "rejects a non-boolean %s",
    (key) => {
      expect(() => parseImportValidationRules({ [key]: "yes" })).toThrow(DomainError);
      expect(() => parseImportValidationRules({ [key]: 1 })).toThrow(DomainError);
    },
  );
});
