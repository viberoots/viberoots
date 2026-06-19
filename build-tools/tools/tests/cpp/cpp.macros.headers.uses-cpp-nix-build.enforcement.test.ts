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

test("nix_cpp_headers uses cpp_nix_build route", async () => {
  const cppDefs = await fsp.readFile("viberoots/build-tools/cpp/defs.bzl", "utf8");
  const body = sliceDefBody(cppDefs, "nix_cpp_headers");

  assert.ok(
    body.includes("prepare_language_wiring(") && body.includes('kind = "headers"'),
    'expected nix_cpp_headers to route through prepare_language_wiring(..., kind = "headers")',
  );
  assert.ok(
    body.includes("cpp_nix_build("),
    "expected nix_cpp_headers to delegate to cpp_nix_build(...)",
  );
  assert.ok(
    !body.includes("wire_package_local_planner_visible_stub("),
    "expected nix_cpp_headers to avoid planner stub route",
  );
});
