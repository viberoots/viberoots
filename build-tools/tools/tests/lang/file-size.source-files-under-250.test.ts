#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFileSizeOffenders, SOURCE_FILES_SCOPE } from "../../dev/file-size-lint";
import { resolveSourceFileSizeExceptionPaths } from "../../dev/file-size-lint-exceptions";

test("repo-owned code files remain under the 250 LOC methodology gate", async () => {
  const root = (process.env.WORKSPACE_ROOT || process.cwd()).trim();
  assert.ok(root.length > 0, "WORKSPACE_ROOT is empty");

  assert.deepEqual(SOURCE_FILES_SCOPE, {
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
  });

  const offenders = await findFileSizeOffenders({
    root,
    changedOnly: false,
    threshold: 250,
    failOnOffenders: true,
    allowKnown: true,
    scope: SOURCE_FILES_SCOPE,
  });

  const offenderFiles = offenders.map((o) => o.file).sort();
  const known = new Set(await resolveSourceFileSizeExceptionPaths(root));
  assert.deepEqual(
    offenderFiles.filter((file) => !known.has(file)),
    [],
  );
  assert.deepEqual(offenderFiles, [
    "projects/apps/pleomino/src/game/solver/static-interesting-solutions.ts",
  ]);
});
