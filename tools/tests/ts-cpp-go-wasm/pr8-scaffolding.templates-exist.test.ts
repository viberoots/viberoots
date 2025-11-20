#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("pr8: scaffolding templates list includes ts/go-cpp-lib and ts/wasm-app", async () => {
  await runInTemp("pr8-templates-exist", async (_tmp, $) => {
    const { stdout } = await $`node tools/scaffolding/scaf.ts templates ts`;
    const out = String(stdout || "");
    if (!out.includes("ts\tgo-cpp-lib")) {
      throw new Error("missing ts/go-cpp-lib in scaf templates list");
    }
    if (!out.includes("ts\twasm-app")) {
      throw new Error("missing ts/wasm-app in scaf templates list");
    }
  });
});
