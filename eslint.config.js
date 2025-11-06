import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import bucknix from "./tools/eslint-plugin-bucknix/index.js";

export default [
  {
    files: ["**/*.ts"],
    ignores: [
      "**/node_modules/**",
      "**/buck-out/**",
      "**/.direnv/**",
      "**/coverage/**",
      "**/.clinic/**",
      "tools/scaffolding/templates/**",
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
