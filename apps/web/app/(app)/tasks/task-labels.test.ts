import { describe, expect, it } from "vitest";

import {
  TASK_ACTION_LABELS,
  TASK_PRIORITY_VIEW,
  TASK_STATUS_TRANSITIONS,
  TASK_STATUS_VIEW,
  formatTaskDay,
  formatTaskInstant,
  isTerminalTaskStatus,
  taskActionLabel,
  taskAllowedTargets,
  taskDueView,
  taskPriorityView,
  taskStatusView,
} from "./task-labels";

describe("taskStatusView", () => {
  it("labels every stored status", () => {
    expect(TASK_STATUS_VIEW).toEqual({
      open: { tone: "info", label: "Open" },
      in_progress: { tone: "warning", label: "In progress" },
      blocked: { tone: "danger", label: "Blocked" },
      resolved: { tone: "success", label: "Resolved" },
      dismissed: { tone: "info", label: "Dismissed" },
    });
  });

  it("falls back to the raw status for an unknown value", () => {
    expect(taskStatusView("done")).toEqual({ tone: "info", label: "done" });
  });
});

describe("taskPriorityView", () => {
  it("labels the common free-text priorities", () => {
    expect(TASK_PRIORITY_VIEW).toEqual({
      low: { tone: "info", label: "Low" },
      normal: { tone: "info", label: "Normal" },
      high: { tone: "warning", label: "High" },
      urgent: { tone: "danger", label: "Urgent" },
    });
  });

  it("passes an unlisted free-text priority through unchanged", () => {
    expect(taskPriorityView("ASAP")).toEqual({ tone: "info", label: "ASAP" });
  });
});

describe("taskAllowedTargets", () => {
  it("offers exactly the legal targets for each status", () => {
    expect(TASK_STATUS_TRANSITIONS).toEqual({
      open: ["in_progress", "blocked", "dismissed"],
      in_progress: ["resolved", "blocked", "dismissed"],
      blocked: ["in_progress", "dismissed"],
      resolved: [],
      dismissed: [],
    });
    expect(taskAllowedTargets("open")).toEqual(["in_progress", "blocked", "dismissed"]);
    expect(taskAllowedTargets("blocked")).toEqual(["in_progress", "dismissed"]);
    expect(taskAllowedTargets("resolved")).toEqual([]);
    expect(taskAllowedTargets("unknown")).toEqual([]);
  });
});

describe("taskActionLabel", () => {
  it("labels every transition target and falls back", () => {
    expect(TASK_ACTION_LABELS).toEqual({
      in_progress: "Start",
      blocked: "Block",
      resolved: "Resolve",
      dismissed: "Dismiss",
    });
    expect(taskActionLabel("in_progress")).toBe("Start");
    expect(taskActionLabel("weird")).toBe("weird");
  });
});

describe("isTerminalTaskStatus", () => {
  it("is true only for resolved and dismissed", () => {
    expect(isTerminalTaskStatus("resolved")).toBe(true);
    expect(isTerminalTaskStatus("dismissed")).toBe(true);
    expect(isTerminalTaskStatus("open")).toBe(false);
    expect(isTerminalTaskStatus("in_progress")).toBe(false);
    expect(isTerminalTaskStatus("blocked")).toBe(false);
  });
});

describe("formatTaskDay / formatTaskInstant", () => {
  it("shows an em dash for a missing day and the raw day otherwise", () => {
    expect(formatTaskDay(null)).toBe("—");
    expect(formatTaskDay("2026-10-01")).toBe("2026-10-01");
  });

  it("formats an ISO instant as UTC to the minute", () => {
    expect(formatTaskInstant("2026-09-24T09:07:03.500Z")).toBe("2026-09-24 09:07 UTC");
  });
});

describe("taskDueView", () => {
  it("flags overdue, due today and upcoming", () => {
    expect(taskDueView("2026-09-23", "2026-09-24", "open")).toEqual({
      tone: "danger",
      label: "Overdue",
    });
    expect(taskDueView("2026-09-24", "2026-09-24", "open")).toEqual({
      tone: "warning",
      label: "Due today",
    });
    expect(taskDueView("2026-10-01", "2026-09-24", "in_progress")).toEqual({
      tone: "info",
      label: "Upcoming",
    });
  });

  it("returns null for a task with no due date or a terminal status", () => {
    expect(taskDueView(null, "2026-09-24", "open")).toBeNull();
    expect(taskDueView("2026-09-01", "2026-09-24", "resolved")).toBeNull();
    expect(taskDueView("2026-09-01", "2026-09-24", "dismissed")).toBeNull();
  });
});
