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
      'load("//node:defs.bzl", "nix_node_test")\n',
      'nix_node_test(name="t", out="o.stamp", cmd="echo ok > $OUT")\n',
    ].join("");
    await fs.outputFile(path.join(tmp, "TARGETS"), targets);

    let failed = false;
    try {
      await $`buck2 build //:t`;
    } catch (e) {
      failed = true;
      assert.match(String(e), /Exactly one importer-scoped lockfile label/);
    }
    assert.equal(failed, true, "build should fail without lockfile label");
  });
});
