import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AreaTabs,
  Collapsible,
  DataTable,
  FileField,
  NumberField,
  ProgressBar,
  areaTabActiveHref,
} from "./patterns";

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe("DataTable", () => {
  const columns = [
    { key: "code", header: "Batch" },
    { key: "qty", header: "Quantity", align: "right" as const },
  ];
  const rows = [{ code: "B-42", qty: "12 kg" }];

  it("maps columns to headers and cells in column order", () => {
    const html = render(createElement(DataTable, { caption: "Batches", columns, rows }));
    expect(html.indexOf("Batch")).toBeLessThan(html.indexOf("Quantity"));
    expect(html).toContain("B-42");
    expect(html).toContain("12 kg");
    expect(html).toMatch(/text-align:\s*right/i);
  });

  it("wraps the first cell in rowHref and leaves the rest unlinked", () => {
    const html = render(
      createElement(DataTable, {
        caption: "Batches",
        columns,
        rows,
        rowHref: (row) => `/b/${row.code}`,
      }),
    );
    expect(html).toContain('<a href="/b/B-42"');
    expect(html).toContain("B-42");
    // Only the primary cell is linked.
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it("renders the empty state row when there are no rows", () => {
    const html = render(
      createElement(DataTable, {
        caption: "Batches",
        columns,
        rows: [],
        emptyMessage: "No batches yet",
      }),
    );
    expect(html).toMatch(/colspan="2"/i);
    expect(html).toContain("No batches yet");
  });
});

describe("ProgressBar", () => {
  it("clamps a value above max and clamps negatives to zero", () => {
    const over = render(createElement(ProgressBar, { value: 150, max: 100 }));
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('aria-valuemax="100"');
    expect(over).toContain("width:100%");

    const under = render(createElement(ProgressBar, { value: -5 }));
    expect(under).toContain('aria-valuenow="0"');
  });

  it("falls back to a 100 max when max is not positive", () => {
    const html = render(createElement(ProgressBar, { value: 50, max: 0 }));
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="50"');
  });

  it("exposes the label as the accessible name", () => {
    const html = render(createElement(ProgressBar, { value: 25, label: "Month closed" }));
    expect(html).toContain('aria-label="Month closed"');
  });
});

describe("NumberField", () => {
  it("renders a unit suffix and a decimal keyboard by default", () => {
    const html = render(createElement(NumberField, { name: "qty", label: "Quantity", unit: "kg" }));
    expect(html).toContain('type="number"');
    expect(html).toMatch(/inputmode="decimal"/i);
    expect(html).toContain('id="field-qty-unit"');
    expect(html).toContain(">kg</span>");
    expect(html).toContain('aria-describedby="field-qty-unit"');
  });

  it("announces both the error and the unit when invalid", () => {
    const html = render(
      createElement(NumberField, { name: "qty", label: "Quantity", unit: "kg", error: "Required" }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="field-qty-error field-qty-unit"');
  });
});

describe("Collapsible", () => {
  it("is a native details/summary disclosure, collapsed by default", () => {
    const html = render(
      createElement(
        Collapsible,
        { summary: "History", badge: "3 events" } as never,
        createElement("p", {}, "Older rows"),
      ),
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("aquarela-disclosure");
    expect(html).toContain("History");
    expect(html).toContain("3 events");
    expect(html).toContain("Older rows");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("opens initially with defaultOpen and accepts native open/onToggle", () => {
    const defaultOpen = render(
      createElement(Collapsible, { summary: "History", defaultOpen: true } as never, "rows"),
    );
    expect(defaultOpen).toMatch(/<details[^>]*\bopen\b/);
  });
});

describe("FileField", () => {
  it("keeps the native file input with the shared label/help wiring", () => {
    const html = render(
      createElement(FileField, {
        name: "invoice",
        label: "Invoice scan",
        accept: "image/*,.pdf",
        help: "PNG, JPG or PDF, up to 10 MB.",
      }),
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*,.pdf"');
    expect(html).toContain('id="field-invoice"');
    expect(html).toContain('for="field-invoice"');
    expect(html).toContain("aquarela-file");
    expect(html).toContain('aria-describedby="field-invoice-help"');
    expect(html).toContain('id="field-invoice-help"');
  });

  it("wires an error to aria-invalid and the error id", () => {
    const html = render(
      createElement(FileField, { name: "invoice", label: "Invoice scan", error: "Required" }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="field-invoice-error"');
    expect(html).toContain('id="field-invoice-error"');
  });
});

describe("AreaTabs", () => {
  const items = [
    { href: "/costs", label: "Overview" },
    { href: "/costs/cost-cards", label: "Cost cards" },
  ];

  it("resolves the active href to the longest matching prefix", () => {
    expect(areaTabActiveHref("/costs", items)).toBe("/costs");
    expect(areaTabActiveHref("/costs/cost-cards", items)).toBe("/costs/cost-cards");
    expect(areaTabActiveHref("/costs/cost-cards/42", items)).toBe("/costs/cost-cards");
  });

  it("only matches a parent path on a segment boundary and misses otherwise", () => {
    expect(areaTabActiveHref("/costs-other", items)).toBeUndefined();
    expect(areaTabActiveHref("/elsewhere", items)).toBeUndefined();
  });

  it("marks aria-current on the active link only", () => {
    const html = render(
      createElement(AreaTabs, {
        pathname: "/costs/cost-cards",
        items,
        ariaLabel: "Costs sections",
      }),
    );
    expect(html).toContain('aria-label="Costs sections"');
    expect(html).toContain('href="/costs/cost-cards"');
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });
});
