#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp start fails with missing attr arg", async () => {
  await runInTemp("patch-cpp-start-missing-arg", async (tmp, $) => {
    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({ cwd: tmp, stdio: "pipe" })`tools/bin/patch-pkg start cpp`.nothrow();
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (out.exitCode === 0) {
      console.error("expected non-zero exit for missing arg");
      process.exit(2);
    }
    if (!all.includes("missing <attr> nixpkgs attribute, e.g. pkgs.zlib or zlib")) {
      console.error("expected missing-arg message not found");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
  });
});
