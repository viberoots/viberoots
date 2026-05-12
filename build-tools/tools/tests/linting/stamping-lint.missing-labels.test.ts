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
      path.join(process.cwd(), "build-tools/tools/dev/stamping-lint.ts"),
      path.join(tmp, "build-tools/tools/dev/stamping-lint.ts"),
    );
    const res = await $({
      cwd: tmp,
      env: { ...process.env },
    })`node --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/dev/stamping-lint.ts`.nothrow();
    const out = String(res.stdout || "") + String(res.stderr || "");
    assert.notEqual(res.exitCode, 0);
    assert.match(out, /missing label lang:go/);
  });
});
