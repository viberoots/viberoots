#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go start fails with missing module arg", async () => {
  await runInTemp("patch-go-start-missing-arg", async (tmp, $) => {
    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({ cwd: tmp, stdio: "pipe" })`tools/bin/patch-pkg start go`.nothrow();
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (out.exitCode === 0) {
      console.error("expected non-zero exit for missing arg");
      process.exit(2);
    }
    if (!all.includes("missing <module> import path, e.g. golang.org/x/net")) {
      console.error("expected missing-arg message not found");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});
