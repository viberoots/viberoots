#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macro: lockfile label is required (exactly one)", async () => {
  await runInTemp("node-macro-lockfile-required", async (tmp, $) => {
    // minimal TARGETS missing lockfile label
    const targets = [
      'load("@prelude//:rules.bzl", "export_file")',
      'load("//node:defs.bzl", "nix_node_test")',
      "",
      "export_file(",
      '  name = "flake.lock",',
      '  src = "flake.lock",',
      '  visibility = ["PUBLIC"],',
      ")",
      "",
      'nix_node_test(name="t", out="o.stamp", cmd="echo ok > $OUT")',
      "",
    ].join("\n");
    await fs.outputFile(path.join(tmp, "TARGETS"), targets);
    await fs.remove(path.join(tmp, "pnpm-lock.yaml"));

    let failed = false;
    try {
      await $`buck2 build //:t`;
    } catch (e) {
      failed = true;
      assert.match(
        String(e),
        /nix_node_test: missing lockfile at pnpm-lock\.yaml\. Provide lockfile_label or create pnpm-lock\.yaml\./,
      );
    }
    assert.equal(failed, true, "build should fail without lockfile label");
  });
});
