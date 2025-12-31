#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function readText(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8");
}

test("macro call sites keep single merge points (labels/deps) and avoid post-wiring stamping", async () => {
  const goDefs = await readText("go/defs.bzl");
  assert.ok(
    !goDefs.includes("deps_out"),
    "go/defs.bzl: nix_go_test should not post-process wiring.deps via deps_out; filter base deps before wiring",
  );

  const cppDefs = await readText("cpp/defs.bzl");
  assert.ok(
    !/dedupe_preserve\(\(kw\.get\("labels"/.test(cppDefs),
    'cpp/defs.bzl: avoid merging labels via dedupe_preserve((kw.get("labels"...)) after wiring; merge once before wiring',
  );

  const pyDefs = await readText("python/defs.bzl");
  assert.ok(
    !pyDefs.includes("stamp_wasm_variant(wiring.kwargs"),
    "python/defs.bzl: nix_python_wasm_* must not stamp wasm labels on wiring.kwargs; stamp before wiring",
  );
});
