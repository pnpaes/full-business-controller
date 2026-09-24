import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import {
  TASK_STATUSES,
  TASK_STATUS_TRANSITIONS,
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  isTerminalTaskStatus,
} from "./status-machine";

describe("task status machine (DEC-122)", () => {
  const LEGAL: readonly (readonly [string, string])[] = [
    ["open", "in_progress"],
    ["open", "blocked"],
    ["open", "dismissed"],
    ["in_progress", "resolved"],
    ["in_progress", "blocked"],
    ["in_progress", "dismissed"],
    ["blocked", "in_progress"],
    ["blocked", "dismissed"],
  ];

  it("allows exactly the eight recorded transitions", () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(canTransitionTaskStatus(from, to)).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it.each(LEGAL)("accepts %s -> %s", (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
    expect(() => assertTaskStatusTransition(from, to)).not.toThrow();
  });

  it.each([
    ["open", "open"],
    ["open", "resolved"],
    ["in_progress", "open"],
    ["in_progress", "in_progress"],
    ["blocked", "open"],
    ["blocked", "blocked"],
    ["blocked", "resolved"],
    ["resolved", "open"],
    ["resolved", "in_progress"],
    ["resolved", "blocked"],
    ["resolved", "resolved"],
    ["resolved", "dismissed"],
    ["dismissed", "open"],
    ["dismissed", "in_progress"],
    ["dismissed", "blocked"],
    ["dismissed", "resolved"],
    ["dismissed", "dismissed"],
  ])("rejects the unlisted transition %s -> %s", (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
    expect(() => assertTaskStatusTransition(from, to)).toThrow(DomainError);
  });

  it.each([
    ["done", "in_progress"],
    ["cancelled", "in_progress"],
    ["bogus", "in_progress"],
  ])("rejects a transition from the unknown status %s", (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
    expect(() => assertTaskStatusTransition(from, to)).toThrow(DomainError);
  });

  it("rejects a transition to an unknown target status", () => {
    expect(canTransitionTaskStatus("open", "done")).toBe(false);
    expect(() => assertTaskStatusTransition("open", "done_or_whatever")).toThrow(DomainError);
  });

  it("marks resolved and dismissed terminal and nothing else", () => {
    expect(TASK_STATUS_TRANSITIONS.resolved).toEqual([]);
    expect(TASK_STATUS_TRANSITIONS.dismissed).toEqual([]);
    expect(isTerminalTaskStatus("resolved")).toBe(true);
    expect(isTerminalTaskStatus("dismissed")).toBe(true);
    expect(isTerminalTaskStatus("open")).toBe(false);
    expect(isTerminalTaskStatus("in_progress")).toBe(false);
    expect(isTerminalTaskStatus("blocked")).toBe(false);
  });
});
