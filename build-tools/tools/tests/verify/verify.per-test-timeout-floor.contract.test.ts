#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify forwards a minimum 20 minute pnpm and test timeout budget", async () => {
  const buck2TestTxt = await fsp.readFile("build-tools/tools/dev/verify/buck2-test.ts", "utf8");
  const buck2TestEnvTxt = await fsp.readFile(
    "build-tools/tools/dev/verify/buck2-test-env.ts",
    "utf8",
  );
  if (!buck2TestTxt.includes("const minPerTestTimeoutSecs = 20 * 60;")) {
    throw new Error("verify must define a 20 minute minimum per-test timeout budget");
  }
  if (!buck2TestTxt.includes("Math.max(minPerTestTimeoutSecs")) {
    throw new Error("verify must clamp per-test budgets to the 20 minute floor");
  }
  for (const fragment of [
    "`TEST_NIX_TIMEOUT_SECS=${opts.testNixTimeoutSecs}`",
    "`NIX_PNPM_FETCH_TIMEOUT=${opts.testNixTimeoutSecs}`",
    "`NIX_PNPM_INSTALL_TIMEOUT=${opts.testNixTimeoutSecs}`",
  ]) {
    if (!buck2TestEnvTxt.includes(fragment)) {
      throw new Error(`verify buck2 runner must forward ${fragment}`);
    }
  }
  if (
    !buck2TestTxt.includes('"--timeout",') ||
    !buck2TestTxt.includes("String(testNixTimeoutSecs)")
  ) {
    throw new Error("verify must forward its per-test timeout to Buck's test executor");
  }
  if (!buck2TestTxt.includes("Math.max(tsec, testNixTimeoutSecs + 5 * 60)")) {
    throw new Error(
      "verify must ensure the overall buck2 timeout does not undercut per-test timeouts",
    );
  }
  if (!buck2TestTxt.includes("opts.exactOverallTimeoutSecs ??")) {
    throw new Error("verify must allow explicit callers to preserve an exact overall timeout");
  }
});
