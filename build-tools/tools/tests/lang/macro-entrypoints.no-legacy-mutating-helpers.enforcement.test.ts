#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

const macroEntrypointFiles = [
  "build-tools/go/defs.bzl",
  "build-tools/cpp/defs.bzl",
  "build-tools/node/defs_core.bzl",
  "build-tools/node/defs_nix.bzl",
  "build-tools/node/defs.bzl",
  "build-tools/python/defs.bzl",
  "build-tools/rust/defs.bzl",
];

async function readText(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8");
}

test("macro entrypoints must not call legacy mutating helpers or bypass shared wiring helpers", async () => {
  for (const file of macroEntrypointFiles) {
    const txt = await readText(file);

    assert.ok(
      !txt.includes("_legacy_mutating("),
      `${file} must not call any *_legacy_mutating helper; legacy helpers are migration-only and belong under //build-tools/lang compatibility surfaces`,
    );

    assert.ok(
      !txt.includes("pop_package_local_patch_dirs_and_nixpkg_deps("),
      `${file} must not call pop_package_local_patch_dirs_and_nixpkg_deps(...); use extract/prepare helpers instead`,
    );
  }
});
