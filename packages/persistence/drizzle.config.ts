import { defineConfig } from "drizzle-kit";

// Wired to DATABASE_URL so `drizzle-kit generate` and friends work once the
// persistence slice adds schema. No schema is defined in this foundation.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
