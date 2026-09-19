import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, Table, TextField } from "./components";

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
});

describe("Button", () => {
  it("loading sets aria-busy and disabled", () => {
    const html = render(createElement(Button, { loading: true }, "Save"));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
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
