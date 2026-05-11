#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

async function readTemplate(relativePath: string): Promise<string> {
  return await fsp.readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

test("multi-template parity: ts/wasm module-key helpers align across static, SSR vite, SSR next", async () => {
  const staticAppWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-static/src/wasm-contract.ts.jinja",
  );
  const viteAppWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/src/wasm-contract.ts.jinja",
  );
  const nextAppWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/app/wasm-contract.ts.jinja",
  );
  const viteServerWasm = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/server/wasm-contract.ts.jinja",
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
  const nextBuildScript = await readTemplate(
    "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/scripts/build-ssr.mjs.jinja",
  );

  for (const src of [staticAppWasm, viteAppWasm, nextAppWasm]) {
    assert.match(src, /export function listWasmModules\(\): string\[]/);
    assert.match(src, /export function defaultWasmModuleKey\(\): string/);
    assert.match(src, /export async function readWasmModuleBytes\(moduleKey: string\)/);
  }
  assert.match(nextAppWasm, /runtimeDestinations\.client/);

  assert.match(viteServerWasm, /export async function readServerWasmModuleByteLength/);
  assert.match(viteServerWasm, /runtimeDestinations\.server/);
  assert.match(nextServerWasm, /export function listWasmModules\(\): string\[]/);
  assert.match(nextServerWasm, /export function defaultWasmModuleKey\(\): string/);
  assert.match(nextServerWasm, /export async function readServerWasmModuleByteLength/);

  for (const src of [viteServerTs, nextServerTs]) {
    assert.match(src, /export function listTsModules\(\): string\[]/);
    assert.match(src, /export function defaultTsModuleKey\(\): string/);
    assert.match(src, /const entry = manifest\.modules\.find/);
    assert.match(src, /MODULE_CONTRACTS_DIR/);
    assert.match(src, /toRuntimeImportSpecifier/);
  }

  assert.match(nextBuildScript, /for \(const entry of wasmManifest\.modules \|\| \[\]\)/);
});
