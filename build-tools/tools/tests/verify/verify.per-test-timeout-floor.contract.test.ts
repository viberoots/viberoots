#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify forwards a minimum 20 minute pnpm and test timeout budget", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/verify/buck2-test.ts", "utf8");
  if (!txt.includes("const minPerTestTimeoutSecs = 20 * 60;")) {
    throw new Error("verify must define a 20 minute minimum per-test timeout budget");
  }
  if (!txt.includes("Math.max(minPerTestTimeoutSecs")) {
    throw new Error("verify must clamp per-test budgets to the 20 minute floor");
  }
  for (const fragment of [
    "`TEST_NIX_TIMEOUT_SECS=${testNixTimeoutSecs}`",
    "`NIX_PNPM_FETCH_TIMEOUT=${testNixTimeoutSecs}`",
    "`NIX_PNPM_INSTALL_TIMEOUT=${testNixTimeoutSecs}`",
  ]) {
    if (!txt.includes(fragment)) {
      throw new Error(`verify buck2 runner must forward ${fragment}`);
    }
  }
});
