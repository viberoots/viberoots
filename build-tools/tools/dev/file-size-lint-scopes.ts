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
    "**/*.nix",
  ],
  exclude: [
    "**/dist/**",
    "build-tools/docs/**",
    "docs/**",
    "test-logs/**",
    "buck-out/**",
    "prelude/**",
    "node_modules/**",
    "coverage/**",
  ],
};

export const PROJECT_SOURCE_FILES_SCOPE: FileSizeScope = {
  include: SOURCE_FILES_SCOPE.include.map((pattern) => `projects/${pattern}`),
  exclude: SOURCE_FILES_SCOPE.exclude,
};
