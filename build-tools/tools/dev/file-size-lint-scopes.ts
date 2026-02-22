export type FileSizeScope = {
  include: string[];
  exclude: string[];
};

export const SOURCE_FILES_SCOPE: FileSizeScope = {
  include: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.bzl",
    "**/*.py",
    "**/*.go",
    "**/*.rs",
  ],
  exclude: [
    "build-tools/tools/tests/**",
    "docs/**",
    "test-logs/**",
    "buck-out/**",
    "prelude/**",
    "node_modules/**",
    "coverage/**",
  ],
};

export const SSR_TEST_FILES_SCOPE: FileSizeScope = {
  include: [
    "build-tools/tools/tests/scaffolding/webapp-ssr*.test.ts",
    "build-tools/tools/tests/dev/runnable-commands*.test.ts",
  ],
  exclude: ["buck-out/**", "node_modules/**", "coverage/**"],
};
