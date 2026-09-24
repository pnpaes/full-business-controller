import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// DEC-049 / CVE-2026-39356: identifier and alias builders must stay
// code-controlled. These three syntaxes are the paths by which request input
// could reach `escapeName()`; ban them mechanically instead of relying on
// review. Static string aliases (`.as("literal")`) remain allowed.
const banIdentifier = {
  selector: "CallExpression[callee.object.name='sql'][callee.property.name='identifier']",
  message: "DEC-049: identifiers must stay code-controlled; sql.identifier() is banned.",
};
const banRaw = {
  selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
  message: "DEC-049: raw SQL must stay code-controlled; sql.raw() is banned.",
};
const banDynamicAlias = {
  selector: "CallExpression[callee.property.name='as']:not([arguments.0.type='Literal'])",
  message: "DEC-049: aliases must be static string literals; dynamic .as() is banned.",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      // The dev server runs on its own dist dir (see apps/web/next.config.mjs)
      // so a concurrent `next build` cannot clobber it; its generated types
      // must not be linted.
      "**/.next-dev/**",
      "**/coverage/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
      // Agent Manager worktrees live under the (gitignored) `.kilo/` directory
      // and are separate checkouts; linting them double-reports and breaks the
      // path-scoped exemptions below (e.g. `packages/.../columns.ts`).
      "**/.kilo/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", banIdentifier, banRaw, banDynamicAlias],
    },
  },
  {
    // `columns.ts` uses `sql.raw` to build *string literals* (not identifiers)
    // for `check` constraints from the code-controlled `vocabularies.ts`
    // constants, at DDL build time only — never from request input — and it
    // escapes embedded quotes. `sql.raw` is therefore allowed here while
    // `sql.identifier` and dynamic `.as()` stay banned.
    files: ["packages/persistence/src/schema/columns.ts"],
    rules: {
      "no-restricted-syntax": ["error", banIdentifier, banDynamicAlias],
    },
  },
  prettier,
);
