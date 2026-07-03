#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readTemplate(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("active runtime, planner, and helper surfaces avoid hardcoded legacy wasm paths", async () => {
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
  const runnables = await readTemplate("build-tools/tools/lib/runnables.ts");
  const runnableWasmArtifacts = await readTemplate(
    "build-tools/tools/lib/runnable-wasm-artifacts.ts",
  );
  const plannerManifest = await readTemplate("build-tools/tools/nix/planner/manifest.nix");
  const ssrScaffoldBuild = await readTemplate("build-tools/tools/tests/lib/ssr-scaffold-build.ts");

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

  for (const src of [runnables, plannerManifest, ssrScaffoldBuild]) {
    assert.doesNotMatch(src, /server\/wasm-contract\/top\.wasm/);
  }
  assert.match(runnables, /resolveServerWasmContractArtifact/);
  assert.match(runnableWasmArtifacts, /wasm-modules\.manifest\.json/);
  assert.match(plannerManifest, /runtimeDestinations\.server/);
  assert.match(ssrScaffoldBuild, /missing canonical server runtime wasm asset/);
});
