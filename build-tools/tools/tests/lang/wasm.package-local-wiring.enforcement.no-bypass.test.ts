#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("package-local WASM macros use the shared @viberoots//build-tools/lang wasm wiring helpers", async () => {
  const goDefs = await fsp.readFile("viberoots/build-tools/go/defs.bzl", "utf8");
  const cppDefs = await fsp.readFile("viberoots/build-tools/cpp/wasm_defs.bzl", "utf8");

  assert(
    !goDefs.includes("stamp_wasm_variant("),
    "viberoots/build-tools/go/defs.bzl must not call stamp_wasm_variant directly for package-local WASM macros; use prepare_package_local_wasm_wiring(...)",
  );
  assert(
    goDefs.includes("prepare_language_wiring("),
    "viberoots/build-tools/go/defs.bzl must use prepare_language_wiring(...) for package-local WASM macros",
  );

  assert(
    !cppDefs.includes("stamp_wasm_variant("),
    "viberoots/build-tools/cpp/wasm_defs.bzl must not call stamp_wasm_variant directly for package-local WASM macros; use prepare_package_local_wasm_wiring(...) or wire_package_local_wasm_planner_visible_stub(...)",
  );
  assert(
    cppDefs.includes("prepare_language_wiring("),
    "viberoots/build-tools/cpp/wasm_defs.bzl must use prepare_language_wiring(...) for nix_cpp_wasm_static_lib",
  );
  assert(
    cppDefs.includes("cpp_nix_build("),
    "viberoots/build-tools/cpp/wasm_defs.bzl must route package-local WASM macros through cpp_nix_build(...)",
  );
  assert(
    !cppDefs.includes("wire_package_local_wasm_planner_visible_stub("),
    "viberoots/build-tools/cpp/wasm_defs.bzl must not use wire_package_local_wasm_planner_visible_stub(...) for nix-backed WASM macros",
  );
});
