module.exports = {
  root: true,
  env: { es2023: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: "latest",
    project: false,
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  rules: {
    curly: ["error", "all"],
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/buck-out/**",
    "**/.direnv/**",
    "**/.tmp/**",
    "tools/scaffolding/templates/**",
  ],
};
