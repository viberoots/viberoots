#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import path from "node:path";

test("lint-global-stamping passes (no direct //:flake.lock in macros)", async () => {
  const zxInit = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
  const script = path.join(process.cwd(), "tools", "dev", "lint-global-stamping.ts");
  const res = await $`node --experimental-strip-types --import ${zxInit} ${script}`.nothrow();
  if (res.exitCode !== 0) {
    throw new Error("lint-global-stamping failed:\n" + String(res.stderr || res.stdout || ""));
  }
});
