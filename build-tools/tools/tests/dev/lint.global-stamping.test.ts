#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("lint-global-stamping passes (no direct //.viberoots/workspace:flake.lock in macros)", async () => {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  const script = buildToolPath(process.cwd(), "tools/dev/lint-global-stamping.ts");
  const res = await $`node --experimental-strip-types --import ${zxInit} ${script}`.nothrow();
  if (res.exitCode !== 0) {
    throw new Error("lint-global-stamping failed:\n" + String(res.stderr || res.stdout || ""));
  }
});
