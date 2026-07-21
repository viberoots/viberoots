#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFileSizeOffenders, SOURCE_FILES_SCOPE } from "../../dev/file-size-lint";
import { resolveSourceFileSizeExceptionPaths } from "../../dev/file-size-lint-exceptions";
import { resolveWorkspaceRootsSync } from "../../lib/repo";

function sourceRoot(): string {
  return resolveWorkspaceRootsSync({ start: process.cwd() }).viberootsRoot;
}

test("full source inventory scans the canonical viberoots repository", async () => {
  const offenders = await findFileSizeOffenders({
    root: sourceRoot(),
    changedOnly: false,
    threshold: 1,
    failOnOffenders: true,
    allowKnown: false,
    scope: { include: ["build-tools/tools/lib/repo.ts"], exclude: [] },
  });
  assert.deepEqual(
    offenders.map(({ file }) => file),
    ["build-tools/tools/lib/repo.ts"],
  );
});

test("repo-owned code files remain under the 250 LOC methodology gate", async () => {
  const root = sourceRoot();

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
});
