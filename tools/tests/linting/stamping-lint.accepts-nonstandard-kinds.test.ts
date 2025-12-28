#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import path from "node:path";
import fs from "fs-extra";

test("stamping-lint accepts kind labels beyond bin|lib|test (fixture)", async () => {
  await runInTemp("stamping-lint-kind-vocab", async (tmp, $) => {
    const targets = [
      "genrule(",
      '  name = "bundle_like",',
      '  out = "bundle_like.txt",',
      '  cmd = "echo ok > $OUT",',
      '  labels = ["lang:node", "kind:bundle", "patch_scope:importer-local"],',
      ")",
      "",
    ].join("\n");
    await fs.outputFile(path.join(tmp, "apps/demo/TARGETS"), targets);
    const res = await $({ cwd: tmp, quiet: true })`node tools/dev/stamping-lint.ts`;
    const out = String(res.stdout || "") + String(res.stderr || "");
    assert.match(out, /stamping-lint: OK/);
  });
});
