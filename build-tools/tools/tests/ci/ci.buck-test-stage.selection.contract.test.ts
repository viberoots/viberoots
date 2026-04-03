#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("ci buck-test stage uses the shared verify selection resolver", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/run-stage.ts", "utf8");
  assert.ok(
    txt.includes("resolveRequestedVerifyScope"),
    "expected CI buck-test stage to use the shared verify-selection resolver",
  );
  assert.ok(
    txt.includes("summarizeVerifyScopeDecision"),
    "expected CI buck-test stage to print auditable selection summaries",
  );
  assert.ok(
    txt.includes("[ci] buck-test selection:"),
    "expected CI buck-test stage to log the resolved selection",
  );
});
