#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import path from "node:path";
import fs from "fs-extra";

test("stamping-lint flags targets that have lang:* but are missing patch_scope:*", async () => {
  await runInTemp("stamping-lint-missing-patch-scope", async (tmp, $) => {
    const targets = [
      "load('@prelude//:rules.bzl', 'genrule')",
      "genrule(",
      "  name = 'demo',",
      "  out = 'demo.txt',",
      "  cmd = ': > $OUT',",
      "  labels = ['lang:go'],",
      ")",
      "",
    ].join("\n");
    // Write into a subpackage so we don't overwrite the root TARGETS created by runInTemp,
    // which defines the //:no_cgo platform used by stamping-lint's cquery.
    await fs.outputFile(path.join(tmp, "apps/demo/TARGETS"), targets);

    const res = await $({ cwd: tmp, quiet: true })`node tools/dev/stamping-lint.ts || true`;
    const out = String(res.stdout || "") + String(res.stderr || "");
    assert.match(out, /missing label patch_scope:package-local/);
  });
});
