#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(relPath: string): Promise<string> {
  return await fsp.readFile(relPath, "utf8");
}

test("PR-8 verify enforcement: verify runner checks template-manifest generator freshness", async () => {
  const src = await read("build-tools/tools/dev/verify/run-verify.ts");
  assert.match(src, /gen-template-manifest-artifacts\.ts/);
  assert.match(src, /--check/);
});

test("PR-8 CI enforcement: prebuild-guard stage checks template-manifest generator freshness", async () => {
  const src = await read("build-tools/tools/ci/run-stage.ts");
  assert.match(src, /case\s+"prebuild-guard"/);
  assert.match(src, /gen-template-manifest-artifacts\.ts/);
  assert.match(src, /--check/);
});
