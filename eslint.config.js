import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import viberoots from "./build-tools/tools/eslint-plugin-viberoots/index.js";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/buck-out/**",
      "**/.direnv/**",
      "**/coverage/**",
      "**/.clinic/**",
      "**/.vite-cache/**",
      "**/prelude/**",
      "build-tools/tools/scaffolding/templates/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/node_modules/**",
      "**/buck-out/**",
      "**/.direnv/**",
      "**/coverage/**",
      "**/.clinic/**",
      "**/.vite-cache/**",
      "**/prelude/**",
      "**/._*.ts",
      "**/._*.tsx",
      "build-tools/tools/scaffolding/templates/**",
    ],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
      viberoots,
    },
    rules: {
      curly: ["error", "all"],
      "viberoots/no-raw-graph-json": "error",
      ...prettier.rules,
    },
  },
];
