#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("package-local WASM macros use the shared //lang wasm wiring helpers", async () => {
  const goDefs = await fsp.readFile("go/defs.bzl", "utf8");
  const cppDefs = await fsp.readFile("cpp/defs.bzl", "utf8");

  assert(
    !goDefs.includes("stamp_wasm_variant("),
    "go/defs.bzl must not call stamp_wasm_variant directly for package-local WASM macros; use prepare_package_local_wasm_wiring(...)",
  );
  assert(
    goDefs.includes("prepare_package_local_wasm_wiring("),
    "go/defs.bzl must use prepare_package_local_wasm_wiring(...) for package-local WASM macros",
  );

  assert(
    !cppDefs.includes("stamp_wasm_variant("),
    "cpp/defs.bzl must not call stamp_wasm_variant directly for package-local WASM macros; use prepare_package_local_wasm_wiring(...) or wire_package_local_wasm_planner_visible_stub(...)",
  );
  assert(
    cppDefs.includes("prepare_package_local_wasm_wiring("),
    "cpp/defs.bzl must use prepare_package_local_wasm_wiring(...) for nix_cpp_wasm_static_lib",
  );
  assert(
    cppDefs.includes("wire_package_local_wasm_planner_visible_stub("),
    "cpp/defs.bzl must use wire_package_local_wasm_planner_visible_stub(...) for planner-visible WASM stubs",
  );
});
