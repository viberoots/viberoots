#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

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
  const cppDefs = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/cpp/defs.bzl"),
    "utf8",
  );
  const headers = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/cpp/private/headers.bzl"),
    "utf8",
  );
  const facadeBody = sliceDefBody(cppDefs, "nix_cpp_headers");
  const body = sliceDefBody(headers, "nix_cpp_headers");

  assert.ok(
    facadeBody.includes("_nix_cpp_headers(name, kwargs)"),
    "expected public nix_cpp_headers to delegate to its private implementation",
  );
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
