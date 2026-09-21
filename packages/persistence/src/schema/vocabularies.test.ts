// Guards the TypeScript controlled vocabularies against the authoritative
// `schemas/domain-enums.yaml`. No YAML dependency: the file is small and only
// uses inline lists and block lists, so a ~40-line parser keeps the test
// hermetic. `check` constraints in the table modules are built from these
// arrays, so a drift here is a drift in the database constraints too.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as vocab from "./vocabularies";

const YAML_PATH = new URL("../../../../schemas/domain-enums.yaml", import.meta.url);
const yaml = readFileSync(YAML_PATH, "utf8");

const stripQuotes = (value: string): string => value.replace(/^["']|["']$/g, "");

/** Parses the subset of YAML used by `domain-enums.yaml`: `key: [a, b]` inline
 * lists and `key:\n  - a` block lists, ignoring comments and blank lines. */
const parseEnums = (source: string): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  const lines = source.split("\n");
  let lastKey: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;

    const blockItem = /^-\s*(.+)$/.exec(line);
    if (blockItem && lastKey !== undefined) {
      (result[lastKey] ??= []).push(stripQuotes(blockItem[1] ?? ""));
      continue;
    }

    const entry = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1] ?? "";
    const inline = (entry[2] ?? "").trim();
    lastKey = key;

    if (inline.startsWith("[")) {
      const body = inline.replace(/^\[/, "").replace(/\]$/, "");
      result[key] = body
        .split(",")
        .map((value) => stripQuotes(value.trim()))
        .filter((value) => value !== "");
      lastKey = undefined;
    } else if (inline === "") {
      result[key] = [];
    } else {
      // Scalar value, not a vocabulary list — record it so the reverse check
      // can see every key, then let the assertions reveal the type mismatch.
      result[key] = [stripQuotes(inline)];
      lastKey = undefined;
    }
  }

  return result;
};

const yamlEnums = parseEnums(yaml);

const vocabEntries: [string, readonly string[]][] = (
  Object.entries(vocab) as [string, unknown][]
).filter((entry): entry is [string, readonly string[]] => Array.isArray(entry[1]));

describe("vocabularies vs schemas/domain-enums.yaml", () => {
  it("parses inline and block lists from the yaml", () => {
    expect(yamlEnums["document_status"]).toEqual([
      "draft",
      "submitted",
      "approved",
      "rejected",
      "retired",
    ]);
    expect(yamlEnums["stock_movement_type"]).toContain("transfer_dispatch");
    expect(yamlEnums["allocation_driver"]).toHaveLength(11);
  });

  // Exported vocabularies deliberately not (yet) in `schemas/domain-enums.yaml`.
  // `IMPORT_DISPOSITION` is the `DEC-083` approved-disposition vocabulary: it
  // mirrors the application constant
  // (`packages/application/src/imports/vocabularies.ts`) provisionally and stays
  // a recorded open point until the yaml gains its key. Adding to this list
  // fails the guard below until the exemption is acknowledged there too.
  const YAML_ABSENT_VOCABULARIES: string[] = ["IMPORT_DISPOSITION"];

  it("matches every exported vocabulary that has a yaml key", () => {
    for (const [name, values] of vocabEntries) {
      if (YAML_ABSENT_VOCABULARIES.includes(name)) continue;
      const expected = yamlEnums[name.toLowerCase()];
      expect(expected, `${name} has no schemas/domain-enums.yaml key`).toBeDefined();
      expect([...values].sort(), `${name} drifted from the yaml`).toEqual(
        [...(expected ?? [])].sort(),
      );
    }
  });

  it("keeps only documented exemptions, each still absent from the yaml", () => {
    // The list must hold exactly the documented open points (no silent regrowth)
    // and each exemption must genuinely lack a yaml key, so the entry is removed
    // once its yaml key lands.
    expect(YAML_ABSENT_VOCABULARIES).toEqual(["IMPORT_DISPOSITION"]);
    for (const name of YAML_ABSENT_VOCABULARIES) {
      expect(
        yamlEnums[name.toLowerCase()],
        `${name} exemption is stale: schemas/domain-enums.yaml now defines the key`,
      ).toBeUndefined();
    }
    for (const [name] of vocabEntries) {
      if (YAML_ABSENT_VOCABULARIES.includes(name)) continue;
      expect(
        yamlEnums[name.toLowerCase()],
        `${name} has no schemas/domain-enums.yaml key`,
      ).toBeDefined();
    }
  });

  it("covers the app_user_status and price_scenario_state vocabularies", () => {
    // Regression guard: these were the last two draft-only lists; the yaml keys
    // now exist, so the forward check above must cover them like any other.
    expect(yamlEnums["app_user_status"]).toEqual(["invited", "active", "disabled", "locked"]);
    expect(yamlEnums["price_scenario_state"]).toEqual([
      "draft",
      "submitted",
      "approved",
      "rejected",
    ]);
  });

  it("reports every yaml key that has no exported vocabulary", () => {
    // Keys with no `vocabularies.ts` array. Intentional: MVP scope, no table or
    // `check` uses them yet. Listed explicitly rather than silently ignored so
    // an accidental new yaml key shows up as a failure here.
    const UNEXPORTED_YAML_KEYS = [
      "task_status",
      "channel_code",
      "approval_decision",
      "forecast_grain",
      "valuation_method",
      "period_close_status",
      "adjustment_period_status",
      "employment_type",
      "shift_state",
      "shift_assignment_state",
      "payroll_report_status",
      "allowed_operation",
      "publish_status",
    ];

    const exportedYamlKeys = new Set(vocabEntries.map(([name]) => name.toLowerCase()));
    const unexported = Object.keys(yamlEnums)
      .filter((key) => !exportedYamlKeys.has(key))
      .sort();

    expect(unexported, "a yaml key was added or removed without updating the export").toEqual(
      [...UNEXPORTED_YAML_KEYS].sort(),
    );
  });

  it("parses malformed and unknown values without inventing list entries", () => {
    const fixture = [
      "# a comment line",
      "inline: [a, b, c] # trailing comment",
      "block:",
      "  - first",
      "  # an indented comment",
      "  - second",
      "",
      "unknown_key: some scalar",
    ].join("\n");

    const parsed = parseEnums(fixture);

    expect(parsed["inline"]).toEqual(["a", "b", "c"]);
    expect(parsed["block"]).toEqual(["first", "second"]);
    // A non-list scalar is kept as a single value rather than dropped, so the
    // reverse check still sees the key and a genuine type mismatch fails loudly.
    expect(parsed["unknown_key"]).toEqual(["some scalar"]);
    expect(Object.keys(parsed).sort()).toEqual(["block", "inline", "unknown_key"]);
  });
});
