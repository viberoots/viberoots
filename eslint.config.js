import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import bucknix from "./build-tools/tools/eslint-plugin-bucknix/index.js";

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
    files: ["**/*.ts"],
    ignores: [
      "**/node_modules/**",
      "**/buck-out/**",
      "**/.direnv/**",
      "**/coverage/**",
      "**/.clinic/**",
      "**/.vite-cache/**",
      "**/prelude/**",
      "**/._*.ts",
      "build-tools/tools/scaffolding/templates/**",
    ],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
      bucknix,
    },
    rules: {
      curly: ["error", "all"],
      "bucknix/no-raw-graph-json": "error",
      ...prettier.rules,
    },
  },
];
