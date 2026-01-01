#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

const macroEntrypointFiles = [
  "go/defs.bzl",
  "cpp/defs.bzl",
  "node/defs_core.bzl",
  "node/defs_nix.bzl",
  "node/defs.bzl",
  "python/defs.bzl",
  "rust/defs.bzl",
];

async function readText(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8");
}

test("macro entrypoints must not call legacy mutating helpers or bypass shared wiring helpers", async () => {
  for (const file of macroEntrypointFiles) {
    const txt = await readText(file);

    assert.ok(
      !txt.includes("_legacy_mutating("),
      `${file} must not call any *_legacy_mutating helper; legacy helpers are migration-only and belong under //lang compatibility surfaces`,
    );

    assert.ok(
      !txt.includes("pop_package_local_patch_dirs_and_nixpkg_deps("),
      `${file} must not call pop_package_local_patch_dirs_and_nixpkg_deps(...); use extract/prepare helpers instead`,
    );
  }
});
