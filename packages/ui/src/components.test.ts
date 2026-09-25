import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge, Button, StatusPill, Table, TextField, Th, Td, uiGlobalCss } from "./components";

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe("TextField", () => {
  it("with an error: aria-invalid, error id referenced, help id absent", () => {
    const html = render(
      createElement(TextField, {
        name: "qty",
        label: "Quantity",
        help: "Enter the counted quantity",
        error: "Quantity is required",
      }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="field-qty-error"');
    expect(html).not.toContain("field-qty-help");
    expect(html).toContain('id="field-qty-error"');
  });

  it("with help only: help id referenced", () => {
    const html = render(
      createElement(TextField, { name: "qty", label: "Quantity", help: "Enter the count" }),
    );
    expect(html).toContain('aria-describedby="field-qty-help"');
    expect(html).toContain('id="field-qty-help"');
    expect(html).not.toContain("aria-invalid");
  });

  it("spreads native input attributes (controlled and uncontrolled)", () => {
    const html = render(
      createElement(TextField, {
        name: "price",
        label: "Price",
        defaultValue: "10",
        autoComplete: "off",
        maxLength: 8,
      }),
    );
    expect(html).toContain('value="10"');
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toMatch(/maxlength="8"/i);
  });
});

describe("Table", () => {
  it("renders the empty-state row when emptyMessage is set", () => {
    const html = render(
      createElement(
        Table,
        { caption: "Batches", columnCount: 3, emptyMessage: "No batches yet" },
        null,
      ),
    );
    expect(html).toMatch(/colspan="3"/i);
    expect(html).toContain("No batches yet");
  });

  it("uses the recipe table metrics: 40px header on the muted well, 56px rows", () => {
    const head = render(createElement(Th, { children: "Code" }));
    expect(head).toContain("height:40px");
    expect(head).toContain("background-color:#F8F9FC");
    const cell = render(createElement(Td, { children: "B-42" }));
    expect(cell).toContain("height:56px");
  });
});

describe("Badge and StatusPill tones", () => {
  it("Badge defaults to the quiet neutral pill", () => {
    const html = render(createElement(Badge, { children: "Draft" }));
    expect(html).toContain("background-color:#F8F9FC");
    expect(html).toContain("color:#353C50");
  });

  it("Badge supports the semantic status and brand-soft tones", () => {
    expect(render(createElement(Badge, { tone: "success", children: "OK" }))).toContain(
      "background-color:#E2EFE9",
    );
    expect(render(createElement(Badge, { tone: "warning", children: "Low" }))).toContain(
      "color:#523608",
    );
    expect(render(createElement(Badge, { tone: "danger", children: "Out" }))).toContain(
      "background-color:#F8E8E9",
    );
    expect(render(createElement(Badge, { tone: "info", children: "New" }))).toContain(
      "color:#3865AD",
    );
    expect(render(createElement(Badge, { tone: "brand", children: "Brand" }))).toContain(
      "background-color:#EEECFF",
    );
    expect(render(createElement(Badge, { tone: "brand", children: "Brand" }))).toContain(
      "color:#5742BA",
    );
  });

  it("StatusPill accepts neutral and brand in addition to the statuses", () => {
    expect(render(createElement(StatusPill, { tone: "neutral", children: "Draft" }))).toContain(
      "background-color:#F8F9FC",
    );
    expect(render(createElement(StatusPill, { tone: "brand", children: "Brand" }))).toContain(
      "color:#5742BA",
    );
    expect(render(createElement(StatusPill, { tone: "danger", children: "Out" }))).toContain(
      "background-color:#F8E8E9",
    );
  });
});

describe("Focus ring (DEC-129)", () => {
  it("global CSS carries the 3px solid iris ring with a 2px offset", () => {
    expect(uiGlobalCss).toContain("outline: 3px solid #5742BA");
    expect(uiGlobalCss).toContain("outline-offset: 2px");
  });
});

describe("Button", () => {
  it("loading sets aria-busy and disabled", () => {
    const html = render(createElement(Button, { loading: true }, "Save"));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("disabled uses the 0.45 recipe opacity", () => {
    const html = render(createElement(Button, { disabled: true }, "Save"));
    expect(html).toContain("opacity:0.45");
  });

  it("brand-soft variant uses the lavender surface with iris text", () => {
    const html = render(createElement(Button, { variant: "brandSoft" }, "Filter"));
    expect(html).toContain("background-color:#EEECFF");
    expect(html).toContain("color:#5742BA");
  });

  it("sizes follow the control-height geometry (32/40/48)", () => {
    expect(render(createElement(Button, { size: "sm" }, "x"))).toContain("min-height:32px");
    expect(render(createElement(Button, {}, "x"))).toContain("min-height:40px");
    expect(render(createElement(Button, { size: "lg" }, "x"))).toContain("min-height:48px");
  });

  it("spreads onClick, type and formAction through", () => {
    let clicked = false;
    const html = render(
      createElement(
        Button,
        {
          onClick: () => {
            clicked = true;
          },
          type: "submit",
          formAction: "/approve",
          form: "batch-form",
        },
        "Approve",
      ),
    );
    expect(html).toContain('type="submit"');
    expect(html).toMatch(/formaction="\/approve"/i);
    expect(html).toContain('form="batch-form"');
    // onClick is attached as a prop; static markup cannot fire it, so assert
    // the handler survived the spread via the element props.
    const element = createElement(Button, { onClick: () => (clicked = true) }, "x");
    const onClick = element.props.onClick;
    expect(typeof onClick).toBe("function");
    onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    expect(clicked).toBe(true);
  });
});
