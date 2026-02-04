#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify PR-3 contract: repo-local TMPDIR + coverage gating + disk gate strings present", async () => {
  const tmpRoot = await fsp.readFile("build-tools/tools/dev/verify/tmp-root.ts", "utf8");
  const coverage = await fsp.readFile("build-tools/tools/dev/verify/coverage.ts", "utf8");
  const housekeeping = await fsp.readFile("build-tools/tools/dev/verify/housekeeping.ts", "utf8");

  assert.ok(
    tmpRoot.includes("TEST_TMP_IN_REPO"),
    "expected verify to set TEST_TMP_IN_REPO=1 so temp repos live under the workspace filesystem",
  );
  assert.ok(
    tmpRoot.includes('buck-out", "tmp", "tmpdir'),
    "expected verify to set TMPDIR to buck-out/tmp/tmpdir (workspace-local temp root)",
  );

  assert.ok(
    housekeeping.includes("VERIFY_TARGET_FREE_GB"),
    "expected verify to honor VERIFY_TARGET_FREE_GB (disk gate threshold)",
  );
  assert.ok(
    housekeeping.includes("refused to start"),
    "expected verify to refuse to start when free space remains below the target threshold",
  );

  assert.ok(
    coverage.includes("NODE_V8_COVERAGE") && coverage.includes("enabled"),
    "expected verify coverage to gate raw V8 coverage output behind explicit coverage mode",
  );
});
