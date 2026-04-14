#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFileSizeOffenders, SOURCE_FILES_SCOPE } from "../../dev/file-size-lint";

function isSsrFocusedTest(file: string): boolean {
  return (
    file.startsWith("build-tools/tools/tests/scaffolding/webapp-ssr") ||
    file.startsWith("build-tools/tools/tests/dev/runnable-commands")
  );
}

test("repo-owned file-size gate keeps SSR-focused test modules under 250 LOC", async () => {
  const root = (process.env.WORKSPACE_ROOT || process.cwd()).trim();
  assert.ok(root.length > 0, "WORKSPACE_ROOT is empty");

  assert.equal(
    SOURCE_FILES_SCOPE.exclude.includes("build-tools/tools/tests/**"),
    false,
    "expected repo-owned file-size scope to include build-tools test modules",
  );

  const offenders = await findFileSizeOffenders({
    root,
    changedOnly: false,
    threshold: 250,
    failOnOffenders: true,
    allowKnown: false,
    scope: SOURCE_FILES_SCOPE,
  });
  assert.deepEqual(
    offenders.filter(({ file }) => isSsrFocusedTest(file)),
    [],
  );
});
