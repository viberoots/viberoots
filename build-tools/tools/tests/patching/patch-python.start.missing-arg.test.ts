#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python start fails with missing distribution arg", async () => {
  await runInTemp("patch-python-start-missing-arg", async (tmp, $) => {
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
    })`viberoots/build-tools/tools/bin/patch-pkg start python`.nothrow();
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (out.exitCode === 0) {
      console.error("expected non-zero exit for missing arg");
      process.exit(2);
    }
    if (!all.includes("missing <distribution> name, e.g. requests")) {
      console.error("expected missing-arg message not found");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});
