import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const resolvePackage = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aquarela/application": resolvePackage("./packages/application/src/index.ts"),
      "@aquarela/config": resolvePackage("./packages/config/src/index.ts"),
      // Subpath exports of `@aquarela/domain` (declared in its package.json).
      // Listed before the bare package alias because a string find matches by
      // prefix — without these, `@aquarela/domain/decimal` is rewritten to
      // `.../src/index.ts/decimal` and fails to resolve.
      "@aquarela/domain/decimal": resolvePackage("./packages/domain/src/decimal.ts"),
      "@aquarela/domain/money": resolvePackage("./packages/domain/src/money.ts"),
      "@aquarela/domain/quantity": resolvePackage("./packages/domain/src/quantity.ts"),
      "@aquarela/domain": resolvePackage("./packages/domain/src/index.ts"),
      "@aquarela/jobs-runtime": resolvePackage("./packages/jobs-runtime/src/index.ts"),
      "@aquarela/logger": resolvePackage("./packages/logger/src/index.ts"),
      "@aquarela/persistence": resolvePackage("./packages/persistence/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
