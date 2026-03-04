#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

async function readTemplate(relativePath: string): Promise<string> {
  return await fsp.readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

test("Phase-5 PR-5 policy: active webapp runtime helpers avoid hardcoded single-module wasm paths", async () => {
  const staticClientWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-static/src/wasm-contract.ts.jinja",
  );
  const viteClientWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/src/wasm-contract.ts.jinja",
  );
  const viteServerWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/wasm-contract.ts.jinja",
  );
  const nextClientWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/app/wasm-contract.ts.jinja",
  );
  const nextServerWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/server/wasm-contract.ts.jinja",
  );
  const viteServerTs = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/ts-modules.ts.jinja",
  );
  const nextServerTs = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/server/ts-modules.ts.jinja",
  );

  for (const src of [
    staticClientWasm,
    viteClientWasm,
    viteServerWasm,
    nextClientWasm,
    nextServerWasm,
  ]) {
    assert.doesNotMatch(src, /top\.wasm/);
    assert.match(src, /moduleKey/);
  }

  assert.match(viteServerWasm, /readServerWasmModuleByteLength/);
  assert.match(nextServerWasm, /readServerWasmModuleByteLength/);

  for (const src of [viteServerTs, nextServerTs]) {
    assert.doesNotMatch(src, /entry-server/);
    assert.doesNotMatch(src, /server\/index/);
    assert.doesNotMatch(src, /\.\.\/src\/ts-modules\.manifest\.json/);
    assert.doesNotMatch(src, /\.\.\/app\/ts-modules\.manifest\.json/);
    assert.match(src, /MODULE_CONTRACTS_DIR/);
    assert.match(src, /toRuntimeImportSpecifier/);
  }

  for (const src of [viteServerWasm, nextServerWasm]) {
    assert.doesNotMatch(src, /\.\.\/src\/wasm-modules\.manifest\.json/);
    assert.doesNotMatch(src, /\.\.\/app\/wasm-modules\.manifest\.json/);
    assert.match(src, /MODULE_CONTRACTS_DIR/);
  }
});
