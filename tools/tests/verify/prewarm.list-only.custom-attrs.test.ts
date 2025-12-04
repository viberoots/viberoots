#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("prewarm-toolchains: custom attr list via PREWARM_ATTRS (LIST_ONLY)", async () => {
  const env = {
    ...process.env,
    PREWARM_LIST_ONLY: "1",
    PREWARM_ATTRS: "alpha , beta,gamma",
  };
  const res = await $({
    env,
    stdio: "pipe",
  })`zx-wrapper tools/dev/prewarm-toolchains.ts`.nothrow();
  assert.equal(res.exitCode, 0);
  const txt = String(res.stdout || "").trim();
  const list = JSON.parse(txt) as string[];
  assert.deepEqual(list, ["alpha", "beta", "gamma"]);
});
