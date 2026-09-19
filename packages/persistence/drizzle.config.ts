import { defineConfig } from "drizzle-kit";

// Prefers DATABASE_MIGRATIONS_URL (direct/session connection) over the pooled
// DATABASE_URL, so a direct `npx drizzle-kit migrate` honours the migrations URL
// too. `generate` never touches the database, so the URL is only read on apply.
//
// `npm run db:migrate` (scripts/migrate.mjs, the advisory-locked wrapper) is the
// ONLY sanctioned migration command. A manual operator running `drizzle-kit
// migrate` directly MUST take the same `8675309` session advisory lock first, or
// the manual run can interleave with an in-flight App Platform pre-deploy job.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATIONS_URL ?? process.env.DATABASE_URL ?? "",
  },
});
