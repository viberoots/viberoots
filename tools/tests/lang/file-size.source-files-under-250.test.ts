#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findFileSizeOffenders,
  KNOWN_SOURCE_FILES_OVER_250_LOC,
  SOURCE_FILES_SCOPE,
} from "../../dev/file-size-lint";

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
      "tools/tests/**",
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

  // Temporary: the source-files scope is enforced and only a small allowlist may remain while large
  // files are split into focused modules.
  const offenderFiles = offenders.map((o) => o.file).sort();
  const known = [...KNOWN_SOURCE_FILES_OVER_250_LOC].sort();
  assert.deepEqual(offenderFiles, known);
});
