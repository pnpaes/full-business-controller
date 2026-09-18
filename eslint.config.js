import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
);
