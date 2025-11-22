#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python wasm-app scaffold (smoke)", async () => {
  await runInTemp("python-wasm-app-smoke", async (_tmp, $) => {
    const out = await $`scaf new python wasm-app demo-wasm --yes --dry-run`.nothrow();
    if (out.exitCode !== 0) {
      throw new Error("scaf new python wasm-app demo-wasm --dry-run failed");
    }
  });
});
