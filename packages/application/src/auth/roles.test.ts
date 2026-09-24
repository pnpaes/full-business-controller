// Repository-wide guard on the fixed role-code lists.
//
// Policy (DEC-130): the `owner` holds every capability, so every role gate in
// the repository must list `"owner"`. The repository deliberately has **no**
// implicit owner/admin bypass in `isAuthorizedFor` (`./access.ts`) — privilege
// comes only from data — so owner access is expressed by *listing the role*,
// never by a shortcut in the check. A gate that omits `"owner"` therefore locks
// the owner out of a capability the app tells them they have, which is exactly
// how the HMS recording gate (`apps/web/app/api/v1/hms/access.ts`) regressed.
//
// This test scans every `export const <NAME>_ROLES = [...]` declaration under
// `packages/application/src` and `apps/web/app/api` and asserts it contains
// `"owner"`. Aliases (`X_ROLES = Y_ROLES`) are not array literals and are
// skipped; they inherit the checked array. If a future gate genuinely must
// exclude the owner, add its `path:NAME` key to `OWNER_EXEMPT` below so the
// exclusion is deliberate and reviewed rather than accidental.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** Roots scanned for `*_ROLES` array declarations, relative to the repo root. */
const SCAN_ROOTS = ["packages/application/src", "apps/web/app/api"] as const;

/**
 * Deliberate exclusions, keyed `"<repo-relative path>:<ARRAY_NAME>"`. Empty by
 * policy (DEC-130): a role set that cannot be held by the owner must be an
 * explicit, reviewed decision, never an accidental omission.
 */
const OWNER_EXEMPT: ReadonlySet<string> = new Set([]);

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/** Every non-test `.ts` file under `dir`, as repo-relative paths. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

interface RoleDeclaration {
  readonly file: string;
  readonly name: string;
  readonly body: string;
}

/** Single-line and multi-line `export const NAME_ROLES = [ ... ] as const`. */
const ROLE_ARRAY = /export const ([A-Za-z_][A-Za-z0-9_]*_ROLES)\s*=\s*\[([\s\S]*?)\]\s*as const/g;

function collectRoleDeclarations(): RoleDeclaration[] {
  const declarations: RoleDeclaration[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of collectSourceFiles(join(REPO_ROOT, root))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(ROLE_ARRAY)) {
        const [, name, body] = match;
        if (name !== undefined && body !== undefined) {
          declarations.push({
            file: file.slice(REPO_ROOT.length).replace(/\\/g, "/"),
            name,
            body,
          });
        }
      }
    }
  }
  return declarations;
}

describe("role-code lists", () => {
  const declarations = collectRoleDeclarations();

  it("finds the repository's role arrays (guards a silently empty scan)", () => {
    expect(declarations.length).toBeGreaterThan(0);
  });

  it("every role array lists the owner unless explicitly exempted (DEC-130)", () => {
    const missing = declarations.filter(
      ({ file, name, body }) => !OWNER_EXEMPT.has(`${file}:${name}`) && !/"owner"/.test(body),
    );

    expect(
      missing.map(({ file, name }) => `${file}: ${name}`),
      'these role arrays omit "owner"; add it, or add the array to OWNER_EXEMPT with a reviewed reason',
    ).toEqual([]);
  });
});
