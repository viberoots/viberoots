import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
  {
    files: ["**/*.ts"],
    ignores: [
      "**/node_modules/**",
      "**/buck-out/**",
      "**/.direnv/**",
      "**/.tmp/**",
      "tools/scaffolding/templates/**",
    ],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      curly: ["error", "all"],
      ...prettier.rules,
    },
  },
];
