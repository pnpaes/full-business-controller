import { describe, expect, it } from "vitest";

import { parseApprovePriceScenarioBody, readApprovePriceScenarioBody } from "./body";

describe("parseApprovePriceScenarioBody", () => {
  it("accepts an empty body (both fields optional)", () => {
    expect(parseApprovePriceScenarioBody({})).toEqual({ ok: true, value: {} });
  });

  it("trims the effective window instants", () => {
    expect(
      parseApprovePriceScenarioBody({
        effectiveFrom: " 2026-10-01T00:00:00.000Z ",
        effectiveTo: "2026-11-01T00:00:00.000Z",
      }),
    ).toEqual({
      ok: true,
      value: {
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        effectiveTo: "2026-11-01T00:00:00.000Z",
      },
    });
  });

  it("keeps an explicit null effectiveTo as an open-ended window", () => {
    expect(parseApprovePriceScenarioBody({ effectiveTo: null })).toEqual({
      ok: true,
      value: { effectiveTo: null },
    });
  });

  it("rejects a blank or non-string field", () => {
    expect(parseApprovePriceScenarioBody({ effectiveFrom: "   " })).toEqual({ ok: false });
    expect(parseApprovePriceScenarioBody({ effectiveFrom: 5 })).toEqual({ ok: false });
    expect(parseApprovePriceScenarioBody({ effectiveTo: 5 })).toEqual({ ok: false });
  });
});

describe("readApprovePriceScenarioBody", () => {
  function post(body?: string): Request {
    return new Request("http://localhost/api/v1/costing/price-scenarios/x/approve", {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    });
  }

  it("treats a blank body as an empty object", async () => {
    expect(await readApprovePriceScenarioBody(post())).toEqual({});
    expect(await readApprovePriceScenarioBody(post("   "))).toEqual({});
  });

  it("parses a JSON object body", async () => {
    expect(await readApprovePriceScenarioBody(post('{"effectiveTo":null}'))).toEqual({
      effectiveTo: null,
    });
  });

  it("rejects malformed JSON and non-object JSON", async () => {
    expect(await readApprovePriceScenarioBody(post("{not json"))).toBeUndefined();
    expect(await readApprovePriceScenarioBody(post("[1,2]"))).toBeUndefined();
  });
});
