#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { findFileSizeOffenders, SSR_TEST_FILES_SCOPE } from "../../dev/file-size-lint";

test("SSR-focused test modules remain under the 250 LOC methodology gate", async () => {
  const root = (process.env.WORKSPACE_ROOT || process.cwd()).trim();
  assert.ok(root.length > 0, "WORKSPACE_ROOT is empty");

  assert.deepEqual(SSR_TEST_FILES_SCOPE, {
    include: [
      "build-tools/tools/tests/scaffolding/webapp-ssr*.test.ts",
      "build-tools/tools/tests/dev/runnable-commands*.test.ts",
    ],
    exclude: ["buck-out/**", "node_modules/**", "coverage/**"],
  });

  const offenders = await findFileSizeOffenders({
    root,
    changedOnly: false,
    threshold: 250,
    failOnOffenders: true,
    allowKnown: false,
    scope: SSR_TEST_FILES_SCOPE,
  });
  assert.deepEqual(offenders, []);
});
