#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("go/cpp macros: local_patch_dirs and nixpkg_deps pop logic is centralized in //build-tools/lang helper", async () => {
  const goDefs = await read("build-tools/go/defs.bzl");
  const cppDefs = await read("build-tools/cpp/defs.bzl");

  const forbidden = [
    'kwargs.pop("local_patch_dirs"',
    'kwargs.pop("nixpkg_deps"',
    "pop_local_patch_dirs(",
    "pop_nixpkg_deps(",
    "pop_package_local_patch_dirs_and_nixpkg_deps(",
  ];

  for (const needle of forbidden) {
    assert.ok(
      !goDefs.includes(needle),
      `expected build-tools/go/defs.bzl to avoid direct ${needle}; rely on prepare_language_wiring(...) to extract patch dirs + nixpkg deps`,
    );
    assert.ok(
      !cppDefs.includes(needle),
      `expected build-tools/cpp/defs.bzl to avoid direct ${needle}; rely on prepare_language_wiring(...) to extract patch dirs + nixpkg deps`,
    );
  }

  assert.ok(
    goDefs.includes("prepare_language_wiring("),
    "expected build-tools/go/defs.bzl to call prepare_language_wiring(...)",
  );
  assert.ok(
    cppDefs.includes("prepare_language_wiring("),
    "expected build-tools/cpp/defs.bzl to call prepare_language_wiring(...)",
  );
});
