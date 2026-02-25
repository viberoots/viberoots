#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

test("no references to go_module_patch and no Go auto provider file present", async () => {
  // The Go provider rule was removed; ensure no stale files or references remain.

  // 1) TARGETS.go.auto should not exist anymore
  const goAuto = path.join("third_party", "providers", "TARGETS.go.auto");
  assert.ok(
    !(await fileExists(goAuto)),
    "stale third_party/providers/TARGETS.go.auto should be removed",
  );

  // 2) Providers directory files should not reference go_module_patch(
  const provDir = path.join("third_party", "providers");
  const candidates = [
    "TARGETS",
    "TARGETS.auto",
    "TARGETS.node.auto",
    "TARGETS.python.auto",
    "TARGETS.test.auto",
    "defs_cpp.bzl",
    "defs_node.bzl",
    "defs_python.bzl",
    "provider_index.bzl",
    "provider_index.json",
  ];
  for (const rel of candidates) {
    const txt = await readIfExists(path.join(provDir, rel));
    assert.ok(
      !txt.includes("go_module_patch("),
      `unexpected go_module_patch reference found in third_party/providers/${rel}`,
    );
  }

  // 3) Docs: allow historical mention in design docs; we only enforce no active provider usage in codegen files.
});
