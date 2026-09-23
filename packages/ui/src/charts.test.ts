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

  it("renders a flat non-zero series at mid-plot (numeric)", () => {
    const html = render(createElement(LineChart, { points: [3, 3, 3], ariaLabel: "Flat week" }));
    // width 480, height 200, pads 12/12/8: plotH = 180, mid y = 12 + 90 = 102.
    expect(html).toContain('points="12.00,102.00 240.00,102.00 468.00,102.00"');
  });

  it("renders a single point without NaN/Infinity in the geometry", () => {
    const html = render(createElement(LineChart, { points: [7], ariaLabel: "One day" }));
    expect(html).toContain('points="12.00,102.00"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("renders an empty series as a quiet frame with no polylines", () => {
    const html = render(createElement(LineChart, { points: [], ariaLabel: "No data yet" }));
    expect(html).not.toContain("<polyline");
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain('aria-label="No data yet"');
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

  it("draws zero-value bars at zero height (numeric)", () => {
    const html = render(createElement(BarChart, { values: [0, 0, 0], ariaLabel: "No covers" }));
    const rects = html.match(/<rect[^>]*>/g) ?? [];
    expect(rects.length).toBe(3);
    for (const rect of rects) expect(rect).toContain('height="0"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("keeps a sane rendering for a flat non-zero series (numeric)", () => {
    const html = render(createElement(BarChart, { values: [5, 5, 5], ariaLabel: "Flat covers" }));
    // Flat non-zero: bars render at half the plot height (90px), not zero.
    expect((html.match(/height="90"/g) ?? []).length).toBe(3);
  });
});

describe("DonutChart", () => {
  it("sizes the accent arc to the share (numeric)", () => {
    const html = render(
      createElement(DonutChart, {
        value: 25,
        total: 100,
        centerLabel: "25%",
        ariaLabel: "Share of waste",
      }),
    );
    // Quarter of the circumference on the accent arc: r = (160-10)/2 = 75.
    const c = 2 * Math.PI * 75;
    expect(html).toContain(`stroke-dasharray="${(c * 0.25).toFixed(2)} ${(c * 0.75).toFixed(2)}"`);
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
    // Clamped to a full circle, never more: r = (200-16)/2 = 92.
    const c = 2 * Math.PI * 92;
    expect(html).toContain(`stroke-dasharray="${c.toFixed(2)} 0.00"`);
  });
});
