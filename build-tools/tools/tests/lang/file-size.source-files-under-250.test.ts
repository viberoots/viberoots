#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFileSizeOffenders, SOURCE_FILES_SCOPE } from "../../dev/file-size-lint";
import { resolveSourceFileSizeExceptionPaths } from "../../dev/file-size-lint-exceptions.ts";

test("source files remain under the 250 LOC methodology gate", async () => {
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
    ],
    exclude: [
      "**/dist/**",
      "build-tools/tools/tests/**",
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
  const known = await resolveSourceFileSizeExceptionPaths(root);
  assert.deepEqual(offenderFiles, known);
  assert.deepEqual(known, [
    "projects/apps/pleomino/src/game/solver/static-interesting-solutions.ts",
  ]);
});
