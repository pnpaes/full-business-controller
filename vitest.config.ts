import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const resolvePackage = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@aquarela/application": resolvePackage("./packages/application/src/index.ts"),
      "@aquarela/config": resolvePackage("./packages/config/src/index.ts"),
      "@aquarela/domain": resolvePackage("./packages/domain/src/index.ts"),
      "@aquarela/logger": resolvePackage("./packages/logger/src/index.ts"),
      "@aquarela/persistence": resolvePackage("./packages/persistence/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
