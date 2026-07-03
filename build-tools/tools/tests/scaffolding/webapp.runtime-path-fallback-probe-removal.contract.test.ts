#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("fallback-probe removal: active helper/runtime surfaces use single canonical server wasm path", async () => {
  const viteServerWasm = await readRepoFile(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/wasm-contract.ts.jinja",
  );
  const nextServerWasm = await readRepoFile(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/server/wasm-contract.ts.jinja",
  );
  const scaffoldHelper = await readRepoFile("build-tools/tools/tests/lib/ssr-scaffold-build.ts");

  for (const src of [viteServerWasm, nextServerWasm]) {
    assert.doesNotMatch(src, /wasmCandidatesFor/);
    assert.doesNotMatch(src, /expected runtime paths/);
    assert.match(src, /serverWasmPathFor/);
    assert.match(src, /canonical runtime path/);
  }

  assert.doesNotMatch(scaffoldHelper, /serverWasmCandidates/);
  assert.doesNotMatch(scaffoldHelper, /for \(const candidate of/);
  assert.match(scaffoldHelper, /readCanonicalServerWasmArtifact/);
});
