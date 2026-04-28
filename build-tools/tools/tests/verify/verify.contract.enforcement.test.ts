#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify contract: TMPDIR policy + coverage gating + disk gate strings present", async () => {
  const tmpRoot = await fsp.readFile("build-tools/tools/dev/verify/tmp-root.ts", "utf8");
  const coverage = await fsp.readFile("build-tools/tools/dev/verify/coverage.ts", "utf8");
  const housekeeping = await fsp.readFile("build-tools/tools/dev/verify/housekeeping.ts", "utf8");
  const runVerify = await fsp.readFile("build-tools/tools/dev/verify/run-verify.ts", "utf8");

  assert.ok(
    tmpRoot.includes('process.platform === "linux"'),
    "expected verify TMPDIR policy to branch for Linux hosts",
  );
  assert.ok(
    tmpRoot.includes('"/tmp"') && tmpRoot.includes("bucknix-verify"),
    "expected verify to place Linux temp repos outside the workspace under /tmp",
  );
  assert.ok(
    tmpRoot.includes('TEST_TMP_IN_REPO = "1"'),
    "expected non-Linux verify runs to keep using workspace-local temp repos",
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

  assert.ok(
    !runVerify.includes("process.env.TEST_TIMING_SUMMARY ="),
    "expected verify not to force per-test timing summaries into Buck event streams",
  );
});
