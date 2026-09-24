import type { RecipeTestView } from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  isUuid,
  parseRecipeTestListQuery,
  parseRecordRecipeTestBody,
  toRecipeTestRow,
} from "./recipe-test-rows";

const VERSION = "55555555-5555-4555-8555-555555555555";

describe("isUuid", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(isUuid(VERSION)).toBe(true);
    expect(isUuid(` ${VERSION} `)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("parseRecordRecipeTestBody", () => {
  const minimal = {
    recipeVersionId: VERSION,
    testedAt: "2026-02-01T00:00:00.000Z",
    batchInputQty: "2.000000",
  };

  it("parses a minimal body and converts testedAt to a Date", () => {
    const parsed = parseRecordRecipeTestBody(minimal);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.recipeVersionId).toBe(VERSION);
      expect(parsed.value.testedAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      expect(parsed.value.batchInputQty).toBe("2.000000");
    }
  });

  it("parses the optional observed fields, allowing explicit nulls", () => {
    const parsed = parseRecordRecipeTestBody({
      ...minimal,
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "NOK",
      qualityComments: "dry",
      proposedAdjustment: "more water",
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "NOK",
      qualityComments: "dry",
      proposedAdjustment: "more water",
    });

    const cleared = parseRecordRecipeTestBody({
      ...minimal,
      actualOutputQty: null,
      actualDurationMinutes: null,
      actualCost: null,
      currency: null,
      qualityComments: null,
      proposedAdjustment: null,
    });
    expect(cleared.ok && cleared.value).toMatchObject({
      actualOutputQty: null,
      actualDurationMinutes: null,
      actualCost: null,
      currency: null,
      qualityComments: null,
      proposedAdjustment: null,
    });
  });

  it.each([
    undefined,
    {},
    { ...minimal, recipeVersionId: "nope" },
    { ...minimal, testedAt: "2026-13-01T00:00:00.000Z" },
    { ...minimal, batchInputQty: "" },
    { ...minimal, actualDurationMinutes: -1 },
    { ...minimal, actualOutputQty: 7 },
    { ...minimal, qualityComments: 7 },
  ])("rejects the malformed body %j", (body) => {
    expect(parseRecordRecipeTestBody(body as Record<string, unknown> | undefined).ok).toBe(false);
  });
});

describe("parseRecipeTestListQuery", () => {
  it("accepts an absent filter and a UUID filter", () => {
    expect(parseRecipeTestListQuery(new URLSearchParams())).toEqual({ ok: true, query: {} });
    expect(parseRecipeTestListQuery(new URLSearchParams({ recipeVersionId: VERSION }))).toEqual({
      ok: true,
      query: { recipeVersionId: VERSION },
    });
  });

  it("rejects a malformed version filter", () => {
    expect(parseRecipeTestListQuery(new URLSearchParams({ recipeVersionId: "nope" })).ok).toBe(
      false,
    );
  });
});

describe("toRecipeTestRow", () => {
  it("serializes dates and omits the organization scope", () => {
    const view: RecipeTestView = {
      id: "test-1",
      organizationId: "org-1",
      recipeId: "recipe-1",
      recipeVersionId: VERSION,
      testedAt: new Date("2026-02-01T00:00:00.000Z"),
      batchInputQty: "2.000000",
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "NOK",
      qualityComments: "dry",
      proposedAdjustment: "more water",
      resultingRecipeVersionId: null,
      actorId: "user-1",
      createdAt: new Date("2026-02-01T09:00:00.000Z"),
      testedVersionNo: 1,
      testedVersionState: "approved",
      resultingVersionNo: null,
      resultingVersionState: null,
    };

    const row = toRecipeTestRow(view);
    expect(row).toEqual({
      id: "test-1",
      recipeId: "recipe-1",
      recipeVersionId: VERSION,
      testedAt: "2026-02-01T00:00:00.000Z",
      batchInputQty: "2.000000",
      actualOutputQty: "1.750000",
      actualDurationMinutes: 45,
      actualCost: "12.5000",
      currency: "NOK",
      qualityComments: "dry",
      proposedAdjustment: "more water",
      resultingRecipeVersionId: null,
      testedVersionNo: 1,
      testedVersionState: "approved",
      resultingVersionNo: null,
      resultingVersionState: null,
      actorId: "user-1",
      createdAt: "2026-02-01T09:00:00.000Z",
    });
    expect("organizationId" in row).toBe(false);
  });
});
