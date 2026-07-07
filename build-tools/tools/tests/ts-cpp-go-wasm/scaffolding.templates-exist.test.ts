#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "../scaffolding/lib/viberoots-tools";

test("scaffolding templates list includes ts/go-cpp-lib and ts/wasm-app", async () => {
  await runInTemp("templates-exist", async (_tmp, $) => {
    const { stdout } =
      await $`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} templates ts --json`;
    const rows = JSON.parse(String(stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const ids = new Set(rows.map((row) => `${row.language}/${row.template}`));
    if (!ids.has("ts/go-cpp-lib")) {
      throw new Error("missing ts/go-cpp-lib in scaf templates list");
    }
    if (!ids.has("ts/wasm-app")) {
      throw new Error("missing ts/wasm-app in scaf templates list");
    }
  });
});
