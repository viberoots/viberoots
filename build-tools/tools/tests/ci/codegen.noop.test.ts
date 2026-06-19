#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("codegen: no-op exits 0 and prints OK", async () => {
  await runInTemp("codegen-noop", async (tmp, $) => {
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node viberoots/build-tools/tools/codegen.ts`;
    const out = String(stdout || "");
    if (!out.includes("codegen: OK")) {
      console.error("expected 'codegen: OK' in output");
      process.exit(2);
    }
  });
});
