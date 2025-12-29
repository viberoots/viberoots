#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("go/cpp macros: local_patch_dirs and nixpkg_deps pop logic is centralized in //lang helper", async () => {
  const goDefs = await read("go/defs.bzl");
  const cppDefs = await read("cpp/defs.bzl");

  const forbidden = ['kwargs.pop("local_patch_dirs"', 'kwargs.pop("nixpkg_deps"'];

  for (const needle of forbidden) {
    assert.ok(
      !goDefs.includes(needle),
      `expected go/defs.bzl to avoid direct ${needle}; use pop_package_local_patch_dirs_and_nixpkg_deps(...) instead`,
    );
    assert.ok(
      !cppDefs.includes(needle),
      `expected cpp/defs.bzl to avoid direct ${needle}; use pop_package_local_patch_dirs_and_nixpkg_deps(...) instead`,
    );
  }

  assert.ok(
    goDefs.includes("prepare_package_local_wiring(") ||
      goDefs.includes("prepare_package_local_wiring_v2("),
    "expected go/defs.bzl to call prepare_package_local_wiring(...) or prepare_package_local_wiring_v2(...)",
  );
  assert.ok(
    cppDefs.includes("prepare_package_local_wiring(") ||
      cppDefs.includes("prepare_package_local_wiring_v2("),
    "expected cpp/defs.bzl to call prepare_package_local_wiring(...) or prepare_package_local_wiring_v2(...)",
  );
});
