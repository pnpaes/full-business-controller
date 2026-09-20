import { describe, expect, it } from "vitest";

import { LEGACY_I19_COLUMNS, LEGACY_I19_DEMO_TEXT, parseLegacyI19Rows } from "./legacy-i19";

describe("parseLegacyI19Rows", () => {
  it("parses the demo export, skipping the header and normalizing locale decimals", () => {
    const { rows, errors } = parseLegacyI19Rows(LEGACY_I19_DEMO_TEXT);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    // sourceRowNo is the physical line number, so the header consumes line 1.
    expect(rows[0]!.sourceRowNo).toBe(2);
    expect(rows[0]!.raw).toEqual({
      date: "2026-08-01",
      time: "12:15:00",
      receipt: "R-1001",
      staff: "Paulo Nicioli Paes",
      product: "Demo Espresso Beans",
      variant: "250g",
      quantity: "1",
      gross_price: "129,00",
      discount: "0,00",
      line_total: "129,00",
      location: "Aquarela Kongens Gate",
    });
    expect(rows[0]!.normalized).toMatchObject({
      occurred_at: "2026-08-01T12:15:00Z",
      currency: "NOK",
      gross_amount: "129.00",
      quantity: "1",
      external_id: "Demo Espresso Beans",
      external_transaction_id: "R-1001",
      external_line_id: "R-1001#2",
      location_external_id: "Aquarela Kongens Gate",
    });
    expect(rows[2]!.normalized.gross_amount).toBe("129.00");
    // The line id is unique inside one receipt: both R-1001 rows share the
    // transaction key but not the line key.
    expect(rows[1]!.normalized.external_transaction_id).toBe("R-1001");
    expect(rows[1]!.normalized.external_line_id).toBe("R-1001#3");
  });

  it("accepts rows without a header and a HH:MM clock", () => {
    const { rows, errors } = parseLegacyI19Rows(
      "2026-08-05;10:00;R-9;Staff;Thing;Big;2;10,5;1,0;20,0;Somewhere",
    );
    expect(errors).toEqual([]);
    expect(rows[0]!.sourceRowNo).toBe(1);
    expect(rows[0]!.normalized.occurred_at).toBe("2026-08-05T10:00:00Z");
    expect(rows[0]!.normalized.gross_amount).toBe("20.0");
  });

  it("reports a wrong column count, a bad date and a non-decimal amount", () => {
    const { rows, errors } = parseLegacyI19Rows(
      [
        LEGACY_I19_COLUMNS.join(";"),
        "2026-08-01;12:15:00;R-1;Staff;Thing", // too few columns
        "01-08-2026;12:15:00;R-2;Staff;Thing;;1;1,0;0,0;1,0;Here", // bad date
        "2026-08-01;12:15:00;R-3;Staff;Thing;;1;abc;0,0;1,0;Here", // bad amount
        "",
        "2026-08-01;12:15:00;R-4;Staff;Thing;;1;1,0;0,0;1,0;Here", // valid
      ].join("\n"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceRowNo).toBe(6);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Line 2");
    expect(errors[1]).toContain("Line 3");
    expect(errors[2]).toContain("Line 4");
  });

  it("returns nothing for blank input", () => {
    expect(parseLegacyI19Rows("   \n\n")).toEqual({ rows: [], errors: [] });
  });
});
