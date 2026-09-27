// Repository-wide env/config drift gate (M1(d)).
//
// The environment surface is spread across five places that can silently
// disagree, so a deploy fails on a missing/renamed variable that no test caught:
//
//   1. `packages/config/src/env.ts` — the typed zod schema (source of truth for
//      app config).
//   2. `.env.example` — the human-facing inventory (what an operator copies).
//   3. raw `process.env.X` reads — scheduler/worker/migrator/bootstrap knobs
//      read outside the schema (deliberately raw; see the caveat below).
//   4. Terraform `infra/**/*.tf` — `var.X` must be declared in a `variables.tf`.
//   5. Terraform `infra/**/*.tfvars` — every key must name a declared variable.
//
// This test reads those files (it never runs terraform, Node or a DB) and
// asserts they agree, naming the offending variable and file on failure.
//
// Bounding false positives:
//   - Only statements outside comments are read (line/block comments are stripped
//     before matching), so the commented-out `api` block in
//     `infra/modules/app-platform/main.tf` (`var.api_instance_size`) is ignored.
//   - Dynamic reads (`process.env[name]`, `process.env[key]`) are deliberately
//     NOT matched: only the literal `process.env.X` form is a drift signal.
//   - Test files, `.d.ts` and build output (`node_modules`, `.next`, `dist`, …)
//     are excluded.
//   - The intentionally-raw scheduler/worker/migrator knobs are not required in
//     the zod schema, but they ARE required in `.env.example` (RAW_RUNTIME_KNOBS).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INFRA_DIR = join(REPO_ROOT, "infra");

/** Roots walked for literal `process.env.X` reads (plus root-level `*.mjs`). */
const SOURCE_ROOTS = ["apps", "packages"] as const;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".cjs"] as const;
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".terraform"]);

/**
 * Deliberately-raw runtime knobs: read straight from `process.env` by the
 * scheduler/worker/migrator rather than through the zod schema, but they must
 * still be inventoried in `.env.example`. Listing them here (instead of in the
 * schema) records that choice so a new knob is a visible edit, not silent drift.
 */
const RAW_RUNTIME_KNOBS = [
  "AI_ADVISORY_ENABLED",
  "AI_ADVISORY_CRON",
  "COMPETITOR_COLLECTION_ENABLED",
  "COMPETITOR_COLLECTION_CRON",
  "COMPETITOR_MAX_PAGES_PER_RUN",
  "COMPETITOR_MIN_DELAY_MS",
  "COMPETITOR_TIMEOUT_MS",
  "SCHEDULER_INTERVAL_MS",
  "SCHEDULER_TICKS",
  "MAINTENANCE_CRON",
  "PAYROLL_CRON",
  "MONITOR_CRON",
  "WORKER_HEARTBEAT_MS",
  "WORKER_TICKS",
  "WORKER_HEARTBEAT_ID",
  "PGBOSS_APP_ROLE",
] as const;

/** Crude secret-name shapes (DEC: never commit a real value in `.env.example`). */
function looksSecret(name: string): boolean {
  return /_API_KEY$/.test(name) || /_SECRET/.test(name);
}

function collectFiles(dir: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Hidden directories are build output (`.next`, `.next-verify-*`,
      // `.terraform`, `.git`, …), never tracked source.
      if (!entry.name.startsWith(".") && !EXCLUDED_DIRS.has(entry.name)) {
        files.push(...collectFiles(join(dir, entry.name), extensions));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.name.includes(".test.")) continue;
    if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

const rel = (file: string): string => relative(REPO_ROOT, file).replace(/\\/g, "/");

/** Removes line/block comments so a commented-out read is not a false positive. */
function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
        return "";
      }
      // Strip an inline `//` comment, but not the `//` in `https://`.
      return line.replace(/(\s)\/\/.*$/, "$1");
    })
    .join("\n");
}

/** Literal `process.env.X` reads: variable -> reading files (repo-relative). */
function collectRawReads(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  const files = SOURCE_ROOTS.flatMap((root) =>
    collectFiles(join(REPO_ROOT, root), SOURCE_EXTENSIONS),
  );
  // Root-level `*.mjs` scripts (the task names "the *.mjs scripts" explicitly).
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(join(REPO_ROOT, entry.name));
    }
  }
  for (const file of files) {
    const source = stripTsComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const name = match[1];
      if (name === undefined) continue;
      const existing = reads.get(name) ?? [];
      if (!existing.includes(rel(file))) existing.push(rel(file));
      reads.set(name, existing);
    }
  }
  return reads;
}

interface DotEnvEntry {
  readonly name: string;
  readonly commented: boolean;
  readonly value: string;
  readonly line: number;
}

/** Keys (commented or not) and value-bearing entries in `.env.example`. */
function parseDotEnvExample(text: string): {
  keys: Set<string>;
  entries: DotEnvEntry[];
} {
  const keys = new Set<string>();
  const entries: DotEnvEntry[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^(\s*)(#?)(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match === null) return;
    const name = match[4];
    if (name === undefined) return;
    keys.add(name);
    entries.push({
      name,
      commented: match[2] === "#",
      value: (match[5] ?? "").trim(),
      line: index + 1,
    });
  });
  return { keys, entries };
}

/** Terraform files of a given suffix under `infra/`. */
function collectInfraFiles(suffix: string): string[] {
  return collectFiles(INFRA_DIR, [suffix]);
}

/** `variable "NAME"` declarations, by the directory of their `variables.tf`. */
function collectDeclaredVariables(): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>();
  for (const file of collectInfraFiles(".tf")) {
    if (file.split(/[\\/]/).pop() !== "variables.tf") continue;
    const source = stripHclComments(readFileSync(file, "utf8"));
    const dir = dirname(file);
    const names = declared.get(dir) ?? new Set<string>();
    for (const match of source.matchAll(/\bvariable\s+"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
    declared.set(dir, names);
  }
  return declared;
}

function stripHclComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("#") || trimmed.startsWith("//")) return "";
      return line.replace(/(\s)#.*$/, "$1");
    })
    .join("\n");
}

/** True when `name` is declared in `dir` or an ancestor module within `infra/`. */
function isDeclared(dir: string, name: string, declared: Map<string, Set<string>>): boolean {
  let current: string | undefined = dir;
  while (current !== undefined && current.startsWith(INFRA_DIR)) {
    if (declared.get(current)?.has(name)) return true;
    if (current === INFRA_DIR) break;
    current = dirname(current);
  }
  return false;
}

const rawReads = collectRawReads();
const schemaKeys = new Set(Object.keys(envSchema.shape));
const envExample = parseDotEnvExample(readFileSync(join(REPO_ROOT, ".env.example"), "utf8"));

describe("env surface drift gate (M1(d))", () => {
  it("found reads and example keys (guards a silently empty scan)", () => {
    expect(rawReads.size).toBeGreaterThan(0);
    expect(schemaKeys.size).toBeGreaterThan(0);
    expect(envExample.keys.size).toBeGreaterThan(0);
  });

  it("every process.env.X read is documented in env.ts or .env.example", () => {
    const undocumented = [...rawReads.keys()].filter(
      (name) => !schemaKeys.has(name) && !envExample.keys.has(name),
    );
    expect(
      undocumented.map((name) => `${name} (read in ${rawReads.get(name)?.join(", ")})`),
      "these process.env reads are undocumented; add them to packages/config/src/env.ts (typed) or .env.example (raw), or add the knob to RAW_RUNTIME_KNOBS after documenting it",
    ).toEqual([]);
  });

  it("every env.ts key is present in .env.example", () => {
    const missing = [...schemaKeys].filter((name) => !envExample.keys.has(name));
    expect(
      missing,
      "these packages/config/src/env.ts keys are absent from .env.example; add a commented placeholder (no value)",
    ).toEqual([]);
  });

  it("every intentionally-raw runtime knob is read and inventoried in .env.example", () => {
    const notRead = RAW_RUNTIME_KNOBS.filter((name) => !rawReads.has(name));
    expect(
      notRead,
      "these RAW_RUNTIME_KNOBS are no longer read anywhere; remove them from the list",
    ).toEqual([]);

    const notDocumented = RAW_RUNTIME_KNOBS.filter((name) => !envExample.keys.has(name));
    expect(
      notDocumented,
      "these intentionally-raw runtime knobs are read by process.env but missing from .env.example; document them there (commented placeholder)",
    ).toEqual([]);
  });

  it("every secret-looking .env.example key is commented out or value-less", () => {
    const leaks = envExample.entries.filter(
      (entry) => looksSecret(entry.name) && !entry.commented && entry.value !== "",
    );
    expect(
      leaks.map((entry) => `.env.example:${entry.line}: ${entry.name}=... carries a value`),
      "a secret-looking key must be commented out or leave its value empty; never commit a real secret",
    ).toEqual([]);
  });

  it("every Terraform var.X is declared in a variables.tf (same or parent module)", () => {
    const declared = collectDeclaredVariables();
    const undeclared: string[] = [];
    for (const file of collectInfraFiles(".tf")) {
      const source = stripHclComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/\bvar\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const name = match[1];
        if (name === undefined) continue;
        if (!isDeclared(dirname(file), name, declared)) {
          undeclared.push(`${rel(file)}: var.${name} is not declared in any variables.tf`);
        }
      }
    }
    expect(undeclared, "declare the missing variable in the module's variables.tf").toEqual([]);
  });

  it("every .tfvars key names a declared variable", () => {
    const declared = collectDeclaredVariables();
    const stale: string[] = [];
    for (const file of collectInfraFiles(".tfvars")) {
      const source = stripHclComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
        const name = match[1];
        if (name === undefined) continue;
        if (!isDeclared(dirname(file), name, declared)) {
          stale.push(`${rel(file)}: ${name} is not a declared variable`);
        }
      }
    }
    expect(stale, "remove the stale .tfvars key or declare the variable").toEqual([]);
  });

  it("reports the full union of env vars the app reads", () => {
    const union = [...new Set([...rawReads.keys(), ...schemaKeys])].sort();
    console.log(
      [
        `env surface: ${union.length} vars read by the app`,
        ...union.map(
          (name) =>
            `  ${name} [${schemaKeys.has(name) ? "schema" : "raw"}] ` +
            `<- ${(rawReads.get(name) ?? ["(schema only)"]).join(", ")}`,
        ),
      ].join("\n"),
    );
    // Sanity anchors so a silently-empty scan cannot pass this test.
    expect(union).toContain("DATABASE_URL");
    expect(union).toContain("LOG_LEVEL");
  });
});
