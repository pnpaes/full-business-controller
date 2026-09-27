import { describe, expect, it } from "vitest";

import { aiStateView, formatAiInstant, isAiState, suggestionText } from "./ai-labels";

describe("aiStateView", () => {
  it("maps the four states to a tone and label", () => {
    expect(aiStateView("proposed")).toEqual({ tone: "warning", label: "Proposed" });
    expect(aiStateView("approved")).toEqual({ tone: "success", label: "Approved" });
    expect(aiStateView("rejected")).toEqual({ tone: "danger", label: "Rejected" });
    expect(aiStateView("superseded")).toEqual({ tone: "info", label: "Superseded" });
  });

  it("passes an unknown state through", () => {
    expect(aiStateView("something_new")).toEqual({ tone: "info", label: "something_new" });
  });

  it("only accepts known states", () => {
    expect(isAiState("proposed")).toBe(true);
    expect(isAiState("nope")).toBe(false);
  });
});

describe("formatAiInstant", () => {
  it("renders null as an em dash and an instant to minute precision in UTC", () => {
    expect(formatAiInstant(null)).toBe("—");
    expect(formatAiInstant("2026-09-27T08:15:42.123Z")).toBe("2026-09-27 08:15 UTC");
  });
});

describe("suggestionText", () => {
  it("prefers title/body and falls back to bounded JSON", () => {
    expect(suggestionText({ title: "Raise price", body: "Margin is low" })).toBe(
      "Raise price — Margin is low",
    );
    expect(suggestionText({ title: "Only title" })).toBe("Only title");
    expect(suggestionText({ weird: true })).toBe('{"weird":true}');
  });
});
