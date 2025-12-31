#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function sliceDefBody(fileText: string, defName: string): string {
  const startNeedle = `def ${defName}(`;
  const startIdx = fileText.indexOf(startNeedle);
  assert.ok(startIdx >= 0, `missing ${startNeedle}`);

  const nextDefIdx = fileText.indexOf("\ndef ", startIdx + startNeedle.length);
  if (nextDefIdx >= 0) {
    return fileText.slice(startIdx, nextDefIdx);
  }
  return fileText.slice(startIdx);
}

test("nix_cpp_wasm_emscripten_lib uses prepare_package_local_wiring (no manual wiring drift)", async () => {
  const cppDefs = await fsp.readFile("cpp/defs.bzl", "utf8");
  const body = sliceDefBody(cppDefs, "nix_cpp_wasm_emscripten_lib");

  assert.ok(
    body.includes("wire_package_local_wasm_planner_visible_stub("),
    "expected nix_cpp_wasm_emscripten_lib to route planner-visible stub wiring via wire_package_local_wasm_planner_visible_stub(...)",
  );

  assert.ok(
    !body.includes("planner_stub("),
    "expected nix_cpp_wasm_emscripten_lib to avoid direct planner_stub(...); use wire_* helper instead",
  );
});
