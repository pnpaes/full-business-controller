import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState, MetricBand, MetricHero, MetricSecondary } from "./shell";

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe("EmptyState", () => {
  it("draws a bordered surface by default", () => {
    const html = render(
      createElement(EmptyState, { title: "No rows" } as never, "Import a file to begin."),
    );
    expect(html).toContain("No rows");
    expect(html).toContain("Import a file to begin.");
    expect(html).toContain("background-color:#FFFFFF");
    expect(html).toContain("border:1px solid #E5E8F0");
  });

  it("variant=plain drops the surface and border for use inside a panel", () => {
    const html = render(
      createElement(
        EmptyState,
        { title: "No rows", variant: "plain" } as never,
        "Import a file to begin.",
      ),
    );
    expect(html).toContain("background-color:transparent");
    expect(html).toContain("border:none");
    expect(html).not.toContain("background-color:#FFFFFF");
    expect(html).not.toContain("border:1px solid #E5E8F0");
  });
});

describe("MetricHero", () => {
  it("renders one ranked metric with unit, delta, comparison, meta and info slot", () => {
    const html = render(
      createElement(MetricHero, {
        label: "Net sales",
        value: "123,456.00",
        unit: "NOK",
        delta: "+1.2%",
        trend: "up",
        comparison: "vs forecast",
        meta: "1–30 Sep 2026 · all locations",
        info: createElement("span", {}, "info"),
      }),
    );
    expect(html).toContain("Net sales");
    expect(html).toContain("123,456.00");
    expect(html).toContain("NOK");
    expect(html).toContain("+1.2%");
    expect(html).toContain("↗");
    expect(html).toContain("vs forecast");
    expect(html).toContain("1–30 Sep 2026 · all locations");
    expect(html).toContain("info");
    // The hero role uses the 40px scale step.
    expect(html).toContain("font-size:40px");
    // "+" delta takes the success tone.
    expect(html).toContain("background-color:#E2EFE9");
  });
});

describe("MetricBand", () => {
  it("pairs one hero with ranked secondary metrics", () => {
    const html = render(
      createElement(MetricBand, {
        hero: createElement(MetricHero, { label: "Net sales", value: "1,200", meta: "today" }),
        metrics: [
          createElement(MetricSecondary, { label: "Orders", value: "48", meta: "today" }),
          createElement(MetricSecondary, { label: "Avg ticket", value: "25.00", meta: "today" }),
        ],
      }),
    );
    expect(html).toContain("Net sales");
    expect(html).toContain("Orders");
    expect(html).toContain("Avg ticket");
    expect(html).toContain("48");
    expect(html).toContain("25.00");
  });
});
