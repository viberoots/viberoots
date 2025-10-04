#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import path from "node:path";
import fs from "fs-extra";

test("stamping-lint flags go_* targets missing lang:go", async () => {
  await runInTemp("stamping-lint-missing", async (tmp, $) => {
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
    let failed = false;
    try {
      await $({ cwd: tmp })`node tools/dev/stamping-lint.ts`;
    } catch (e: any) {
      failed = true;
      const out = String(e.stdout || "") + String(e.stderr || "");
      assert.match(out, /missing label lang:go/);
    }
    assert.ok(failed, "lint should fail when labels are missing");
  });
});
