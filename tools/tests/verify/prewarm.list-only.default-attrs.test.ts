#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("prewarm-toolchains: default attr list (LIST_ONLY)", async () => {
  const env = {
    ...process.env,
    PREWARM_LIST_ONLY: "1",
  };
  const res = await $({
    env,
    stdio: "pipe",
  })`zx-wrapper tools/dev/prewarm-toolchains.ts`.nothrow();
  assert.equal(res.exitCode, 0);
  const txt = String(res.stdout || "").trim();
  assert.ok(txt.startsWith("["), "expected JSON array output");
  const list = JSON.parse(txt) as string[];
  assert.deepEqual(list, [
    "toolchains.go",
    "toolchains.cxx",
    "toolchains.emscripten",
    "toolchains.tinygo",
  ]);
});
