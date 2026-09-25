// Repository-wide guard on dynamic route parameter names.
//
// Next.js derives a page/route's parameter keys from the `[...]` folder names in
// its path, but the `params` type each file declares is hand-written. A mismatch
// between the folder name and the key the file reads is invisible to TypeScript
// and only fails at runtime — `apps/web/app/(app)/documents/[id]/page.tsx`
// destructured `documentId` from a `[id]` folder, so every URL rendered a 500.
//
// This walks every `page.tsx`/`route.ts` under `apps/web/app` that receives
// route params and asserts the keys it reads from `params` (or `context.params`)
// all exist as `[...]` segments in its own path.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

interface RouteFile {
  readonly path: string;
  readonly declared: readonly string[];
}

const DYNAMIC_SEGMENT = /^\[(?:\.\.\.)?([^\]]+)\]$/;
const DESTRUCTURED = /\{\s*([^{}]*)\}\s*=\s*await\s+(?:context\.)?params/g;
const MEMBER_ACCESS = /\(\s*await\s+(?:context\.)?params\s*\)\s*\.\s*([A-Za-z0-9_$]+)/g;

function collectRouteFiles(dir: string, params: readonly string[]): RouteFile[] {
  const segment = dir.split(/[\\/]/).pop() ?? "";
  const match = DYNAMIC_SEGMENT.exec(segment);
  const declared = match === null ? params : [...params, match[1] ?? segment];
  const files: RouteFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...collectRouteFiles(join(dir, entry.name), declared));
    } else if ((entry.name === "page.tsx" || entry.name === "route.ts") && declared.length > 0) {
      files.push({ path: join(dir, entry.name).slice(APP_DIR.length + 1), declared });
    }
  }
  return files;
}

function accessedKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(DESTRUCTURED)) {
    for (const part of (match[1] ?? "").split(",")) {
      const key = part.split(":")[0]?.split("=")[0]?.trim();
      if (key) {
        keys.add(key);
      }
    }
  }
  for (const match of source.matchAll(MEMBER_ACCESS)) {
    if (match[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return [...keys];
}

describe("dynamic route parameter names", () => {
  const routeFiles = collectRouteFiles(APP_DIR, []);

  it("finds the app's param-receiving route files (guards a silently empty scan)", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it("every page/route only reads param keys that exist as a [segment] in its path", () => {
    const mismatches = routeFiles.flatMap(({ path, declared }) =>
      accessedKeys(readFileSync(join(APP_DIR, path), "utf8"))
        .filter((key) => !declared.includes(key))
        .map((key) => `${path}: reads params.${key}, but only [${declared.join("], [")}] exist`),
    );

    expect(mismatches).toEqual([]);
  });
});
