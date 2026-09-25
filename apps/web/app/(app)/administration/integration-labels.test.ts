import { describe, expect, it } from "vitest";

import {
  allowedOperationLabel,
  allowedOperationsLabel,
  directionLabel,
  isWriteOperation,
  systemTypeLabel,
  termsStatusLabel,
} from "./integration-labels";

describe("systemTypeLabel", () => {
  it("labels every known system type", () => {
    expect(systemTypeLabel("pos")).toBe("POS");
    expect(systemTypeLabel("medusa")).toBe("Medusa");
    expect(systemTypeLabel("sanity")).toBe("Sanity");
    expect(systemTypeLabel("wolt")).toBe("Wolt");
    expect(systemTypeLabel("fiken")).toBe("Fiken");
    expect(systemTypeLabel("other")).toBe("Other");
  });

  it("reads an unknown system type as itself", () => {
    expect(systemTypeLabel("stripe")).toBe("stripe");
  });
});

describe("directionLabel", () => {
  it("labels every known direction", () => {
    expect(directionLabel("read")).toBe("Read");
    expect(directionLabel("write")).toBe("Write");
    expect(directionLabel("read_write")).toBe("Read + write");
  });

  it("reads an unknown direction as itself", () => {
    expect(directionLabel("bidirectional")).toBe("bidirectional");
  });
});

describe("allowedOperationLabel", () => {
  it("labels every known operation", () => {
    expect(allowedOperationLabel("read")).toBe("Read");
    expect(allowedOperationLabel("write_price")).toBe("Write prices");
    expect(allowedOperationLabel("write_menu_product")).toBe("Write menu products");
    expect(allowedOperationLabel("write_stock")).toBe("Write stock");
    expect(allowedOperationLabel("write_accounting")).toBe("Write accounting");
  });

  it("reads an unknown operation as itself", () => {
    expect(allowedOperationLabel("write_forecast")).toBe("write_forecast");
  });
});

describe("allowedOperationsLabel", () => {
  it("joins the operation labels", () => {
    expect(allowedOperationsLabel(["read", "write_price"])).toBe("Read, Write prices");
  });

  it("states no operations for an empty set", () => {
    expect(allowedOperationsLabel([])).toBe("No operations");
  });
});

describe("termsStatusLabel", () => {
  it("labels every known terms status", () => {
    expect(termsStatusLabel("pending")).toBe("Pending");
    expect(termsStatusLabel("approved")).toBe("Approved");
    expect(termsStatusLabel("rejected")).toBe("Rejected");
  });

  it("reads an unknown terms status as itself", () => {
    expect(termsStatusLabel("expired")).toBe("expired");
  });
});

describe("isWriteOperation", () => {
  it("separates the DEC-015 write operations from a read", () => {
    expect(isWriteOperation("read")).toBe(false);
    expect(isWriteOperation("write_price")).toBe(true);
    expect(isWriteOperation("write_menu_product")).toBe(true);
    expect(isWriteOperation("write_stock")).toBe(true);
    expect(isWriteOperation("write_accounting")).toBe(true);
  });
});
