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
    assert.match(starlarkApi, /"dest": "top\.wasm"/);
    assert.match(starlarkApi, /"dest": "wasm-inline\/py\.js"/);
    assert.match(starlarkApi, /"dest": "server\/wasm-contract\/top\.wasm"/);

    await runInTemp("starlark-api-webapp-wasm-contract", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      await $`scaf new ts webapp-ssr-next demo-ssr-next --yes --no-tests`;
      await $`scaf new ts wasm-linking-app demo-link --yes --no-tests`;

      const staticApp = path.join(tmp, "projects", "apps", "demo-web");
      const nextApp = path.join(tmp, "projects", "apps", "demo-ssr-next");
      const linkingApp = path.join(tmp, "projects", "apps", "demo-link");

      const staticTargets = await fsp.readFile(path.join(staticApp, "TARGETS"), "utf8");
      assert.match(staticTargets, /node_webapp\(/);
      assert.match(staticTargets, /node_wasm_inline_module\(/);
      assert.match(staticTargets, /node_asset_stage\(/);
      assert.match(staticTargets, /"dest": "top\.wasm"/);
      assert.match(staticTargets, /"dest": "wasm-inline\/index\.js"/);
      assert.match(staticTargets, /"dest": "server\/wasm-contract\/top\.wasm"/);

      const nextTargets = await fsp.readFile(path.join(nextApp, "TARGETS"), "utf8");
      assert.match(nextTargets, /node_webapp\(/);
      assert.match(nextTargets, /node_wasm_inline_module\(/);
      assert.match(nextTargets, /node_asset_stage\(/);
      assert.match(nextTargets, /"dest": "client\/public\/top\.wasm"/);
      assert.match(nextTargets, /"dest": "client\/public\/wasm-inline\/index\.js"/);
      assert.match(nextTargets, /"dest": "server\/wasm-contract\/top\.wasm"/);

      const linkingTargets = await fsp.readFile(path.join(linkingApp, "TARGETS"), "utf8");
      assert.match(linkingTargets, /node_asset_stage\(/);
      assert.match(linkingTargets, /"dest": "top\.wasm"/);
      assert.match(linkingTargets, /"dest": "wasm-inline\/py\.js"/);
      const linkingInlineTargets = await fsp.readFile(
        path.join(tmp, "projects", "libs", "demo-link-wasm-inline", "TARGETS"),
        "utf8",
      );
      assert.match(linkingInlineTargets, /\/\/projects\/libs\/demo-link-py-wasm:py_wasm/);

      const staticClientWasm = await fsp.readFile(
        path.join(staticApp, "src", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(staticClientWasm, /export async function readWasmContractBytes\(\)/);
      assert.match(staticClientWasm, /\.\/wasm-contract\/top\.wasm/);
      assert.match(staticClientWasm, /\/wasm-inline\/index\.js/);

      const nextClientWasm = await fsp.readFile(
        path.join(nextApp, "app", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(nextClientWasm, /export async function readWasmContractBytes\(\)/);
      assert.match(nextClientWasm, /\/top\.wasm/);
      assert.match(nextClientWasm, /\/wasm-inline\/index\.js/);

      const nextServerWasm = await fsp.readFile(
        path.join(nextApp, "server", "wasm-contract.ts"),
        "utf8",
      );
      assert.match(nextServerWasm, /export async function readServerWasmContractByteLength\(\)/);
      assert.match(nextServerWasm, /wasmCandidates/);
      assert.match(nextServerWasm, /server wasm contract asset is missing/);
    });
  },
);
