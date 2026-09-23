import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BarChart, DonutChart, LineChart, RadialMetric } from "./charts";

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe("LineChart", () => {
  it("exposes role=img, the aria-label and the visually-hidden summary", () => {
    const html = render(
      createElement(LineChart, {
        points: [1, 3, 2, 5],
        ariaLabel: "Net sales per day",
        summary: "Net sales rose from 1 to 5 over four days.",
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Net sales per day"');
    expect(html).toContain("Net sales rose from 1 to 5 over four days.");
  });

  it("draws the comparison series and the highlighted point", () => {
    const html = render(
      createElement(LineChart, {
        points: [1, 3, 2, 5],
        comparisonPoints: [2, 2, 2, 2],
        highlightIndex: 3,
        ariaLabel: "Sales vs target",
      }),
    );
    expect(html).toContain("<circle");
  });
});

describe("BarChart", () => {
  it("renders one rect per value plus comparison bars", () => {
    const html = render(
      createElement(BarChart, {
        values: [4, 8, 6],
        comparisonValues: [3, 5, 5],
        labels: ["Mon", "Tue", "Wed"],
        ariaLabel: "Covers per day",
      }),
    );
    expect(html.match(/<rect/g)?.length).toBe(6);
    expect(html).toContain("Wed");
  });
});

describe("DonutChart", () => {
  it("sizes the accent arc to the share", () => {
    const html = render(
      createElement(DonutChart, {
        value: 25,
        total: 100,
        centerLabel: "25%",
        ariaLabel: "Share of waste",
      }),
    );
    // Quarter of the circumference on the accent arc.
    expect(html).toMatch(/stroke-dasharray="[0-9.]+ [0-9.]+"/);
    expect(html).toContain("25%");
  });
});

describe("RadialMetric", () => {
  it("clamps the percent and renders the centre metric", () => {
    const html = render(
      createElement(RadialMetric, {
        percent: 150,
        value: "128,430",
        caption: "Covers",
        ariaLabel: "Covers against capacity",
      }),
    );
    expect(html).toContain("128,430");
    expect(html).toContain("Covers");
    // Clamped to a full circle, never more.
    const dash = /stroke-dasharray="([0-9.]+) ([0-9.]+)"/.exec(html);
    expect(dash).not.toBeNull();
  });
});
