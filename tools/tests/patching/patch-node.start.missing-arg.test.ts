#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-node start fails with missing package arg", async () => {
  await runInTemp("patch-node-start-missing-arg", async (tmp, $) => {
    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({ cwd: tmp, stdio: "pipe" })`tools/bin/patch-pkg start node`.nothrow();
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (out.exitCode === 0) {
      console.error("expected non-zero exit for missing arg");
      process.exit(2);
    }
    if (!all.includes("missing <package> name, e.g. lodash or @scope/pkg")) {
      console.error("expected missing-arg message not found");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});
