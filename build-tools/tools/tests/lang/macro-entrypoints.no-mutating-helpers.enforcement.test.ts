#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

const macroEntrypointFiles = [
  "viberoots/build-tools/go/defs.bzl",
  "viberoots/build-tools/cpp/defs.bzl",
  "viberoots/build-tools/node/defs_core.bzl",
  "viberoots/build-tools/node/defs_nix.bzl",
  "viberoots/build-tools/node/defs.bzl",
  "viberoots/build-tools/python/defs.bzl",
  "viberoots/build-tools/rust/defs.bzl",
];

async function readText(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8");
}

test("macro entrypoints must not call removed mutating helpers or bypass shared wiring helpers", async () => {
  for (const file of macroEntrypointFiles) {
    const txt = await readText(file);

    assert.ok(
      !txt.includes("_legacy_mutating("),
      `${file} must not call any *_legacy_mutating helper; use the non-mutating shared wiring helpers`,
    );

    assert.ok(
      !txt.includes("pop_package_local_patch_dirs_and_nixpkg_deps("),
      `${file} must not call pop_package_local_patch_dirs_and_nixpkg_deps(...); use extract/prepare helpers instead`,
    );
  }
});
