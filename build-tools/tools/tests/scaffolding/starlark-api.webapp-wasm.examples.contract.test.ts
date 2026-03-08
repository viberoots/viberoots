#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "starlark API webapp wasm examples align with scaffolded API usage",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const repoRoot = process.cwd();
    const starlarkApi = await fsp.readFile(
      path.join(repoRoot, "docs", "handbook", "starlark-api.md"),
      "utf8",
    );
    assert.match(starlarkApi, /Vite webapp \+ Python wasm library/);
    assert.match(starlarkApi, /nix_python_wasm_lib\(/);
    assert.match(starlarkApi, /"dest": "server\/wasm\/top\.wasm"/);
    assert.match(starlarkApi, /"dest": "wasm-inline\/py\.js"/);
    assert.match(starlarkApi, /node_asset_stage\(/);
    assert.match(starlarkApi, /Augmenting scaffolded webapp templates/);
    assert.match(starlarkApi, /Scaffolded webapps start with no wasm modules/);
    assert.match(starlarkApi, /module_deps = \["\/\/projects\/libs\/demo-ts:demo-ts"\]/);
    assert.match(starlarkApi, /src = "src\/wasm-contract\/top\.wasm"/);

    await runInTemp("starlark-api-webapp-wasm-contract", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts webapp-ssr-next demo-ssr-next --yes --no-tests --skip-lockfile-gen`;

      const staticApp = path.join(tmp, "projects", "apps", "demo-web");
      const nextApp = path.join(tmp, "projects", "apps", "demo-ssr-next");

      const staticTargets = await fsp.readFile(path.join(staticApp, "TARGETS"), "utf8");
      assert.match(staticTargets, /node_webapp\(/);
      assert.match(staticTargets, /node_asset_stage\(/);
      assert.match(staticTargets, /assets = \[\]/);
      assert.doesNotMatch(staticTargets, /node_wasm_inline_module\(/);

      const nextTargets = await fsp.readFile(path.join(nextApp, "TARGETS"), "utf8");
      assert.match(nextTargets, /node_webapp\(/);
      assert.match(nextTargets, /node_asset_stage\(/);
      assert.match(nextTargets, /assets = \[\]/);
      assert.doesNotMatch(nextTargets, /node_wasm_inline_module\(/);

      const staticClientWasm = await fsp.readFile(
        path.join(staticApp, "src", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(staticClientWasm, /export async function readWasmContractBytes\(\)/);
      assert.match(staticClientWasm, /entry\.sourcePath/);
      assert.doesNotMatch(staticClientWasm, /wasm-inline/);

      const nextClientWasm = await fsp.readFile(
        path.join(nextApp, "app", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(nextClientWasm, /export async function readWasmContractBytes\(\)/);
      assert.match(nextClientWasm, /runtimeDestinations\.client/);
      assert.doesNotMatch(nextClientWasm, /wasm-inline/);

      const nextServerWasm = await fsp.readFile(
        path.join(nextApp, "server", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(nextServerWasm, /export async function readServerWasmContractByteLength\(\)/);
      assert.match(nextServerWasm, /serverWasmPathFor/);
      assert.match(nextServerWasm, /canonical runtime path/);
    });
  },
);
