#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import path from "node:path";
import fs from "fs-extra";

test("stamping-lint flags go_* targets missing lang:go", async () => {
  await runInTemp("stamping-lint-missing", async (tmp, $) => {
    const iso = `stamping-lint-missing-labels-${process.pid}-${Date.now()}`;
    // Minimal TARGETS with a raw go_library lacking lang:go label
    const targets = [
      "load('@prelude//:rules.bzl', 'go_library')",
      "go_library(name='demo', srcs=['pkg/demo/demo.go'], labels=[])",
      "",
    ].join("\n");
    await fs.outputFile(path.join(tmp, "TARGETS"), targets);
    await fs.outputFile(path.join(tmp, "pkg/demo/demo.go"), "package demo\n\nfunc X(){}\n");
    // Copy lint script
    await fs.copy(
      path.join(process.cwd(), "tools/dev/stamping-lint.ts"),
      path.join(tmp, "tools/dev/stamping-lint.ts"),
    );
    const env = { ...process.env, BUCK_ISOLATION_DIR: iso };
    try {
      const res = await $({
        cwd: tmp,
        env,
      })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/dev/stamping-lint.ts`.nothrow();
      const out = String(res.stdout || "") + String(res.stderr || "");
      assert.notEqual(res.exitCode, 0);
      assert.match(out, /missing label lang:go/);
    } finally {
      // Ensure the stamping-lint buck2 daemon is not left running.
      await $({
        cwd: tmp,
        env,
        stdio: "ignore",
        reject: false,
        nothrow: true,
      })`buck2 --isolation-dir ${iso} kill`;
    }
  });
});
