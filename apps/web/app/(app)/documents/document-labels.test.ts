import { describe, expect, it } from "vitest";

import {
  DOCUMENT_AUDIENCE_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_STATUS_VIEW,
  documentAudienceLabel,
  documentCategoryLabel,
  documentStatusView,
  formatDocumentInstant,
} from "./document-labels";

describe("documentStatusView", () => {
  it("labels every staff_document_status", () => {
    expect(DOCUMENT_STATUS_VIEW).toEqual({
      draft: { tone: "info", label: "Draft" },
      published: { tone: "success", label: "Published" },
      archived: { tone: "warning", label: "Archived" },
    });
  });

  it("falls back to the raw status for an unknown value", () => {
    expect(documentStatusView("bogus")).toEqual({ tone: "info", label: "bogus" });
  });
});

describe("documentCategoryLabel", () => {
  it("labels every document_category and falls back to the raw value", () => {
    expect(DOCUMENT_CATEGORY_LABELS).toEqual({
      routine: "Routine",
      guideline: "Guideline",
      policy: "Policy",
      form: "Form",
      other: "Other",
    });
    expect(documentCategoryLabel("bogus")).toBe("bogus");
  });
});

describe("documentAudienceLabel", () => {
  it("labels both audiences and falls back to the raw value", () => {
    expect(DOCUMENT_AUDIENCE_LABELS).toEqual({ all_staff: "All staff", managers: "Managers" });
    expect(documentAudienceLabel("bogus")).toBe("bogus");
  });
});

describe("formatDocumentInstant", () => {
  it("formats an ISO instant as UTC to the minute", () => {
    expect(formatDocumentInstant("2026-09-23T13:57:07.123Z")).toBe("2026-09-23 13:57 UTC");
  });
});
