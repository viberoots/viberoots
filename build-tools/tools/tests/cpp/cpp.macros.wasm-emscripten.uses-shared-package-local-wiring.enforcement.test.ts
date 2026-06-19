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

test("nix_cpp_wasm_emscripten_lib uses shared wasm package-local wiring", async () => {
  const cppDefs = await fsp.readFile("viberoots/build-tools/cpp/wasm_defs.bzl", "utf8");
  const body = sliceDefBody(cppDefs, "nix_cpp_wasm_emscripten_lib");

  assert.ok(
    body.includes("prepare_language_wiring(") && body.includes('wasm_variant = "emscripten"'),
    'expected nix_cpp_wasm_emscripten_lib to route through prepare_language_wiring(..., wasm_variant = "emscripten")',
  );

  assert.ok(
    body.includes("cpp_nix_build("),
    "expected nix_cpp_wasm_emscripten_lib to delegate artifact build to cpp_nix_build(...)",
  );
});
