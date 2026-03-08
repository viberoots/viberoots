#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { runSsrViteLocalTsDepTest } from "./lib/webapp-ssr-vite-local-ts-dep";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-ssr-vite scaffolds Phase-1 local dependency Vite contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-vite-hmr-config", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "pipe" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
      const configPath = path.join(tmp, "projects", "apps", "demo-vite-ssr", "vite.config.ts");
      const packageJsonPath = path.join(tmp, "projects", "apps", "demo-vite-ssr", "package.json");
      const wasmContractPath = path.join(
        tmp,
        "projects",
        "apps",
        "demo-vite-ssr",
        "src",
        "wasm-contract.ts",
      );
      const config = await fsp.readFile(configPath, "utf8");
      const packageJson = await fsp.readFile(packageJsonPath, "utf8");
      const wasmContract = await fsp.readFile(wasmContractPath, "utf8");
      const devScript = await fsp.readFile(
        path.join(tmp, "projects", "apps", "demo-vite-ssr", "scripts", "dev.mjs"),
        "utf8",
      );
      const watchScript = await fsp.readFile(
        path.join(tmp, "projects", "apps", "demo-vite-ssr", "scripts", "dev-wasm-watch.mjs"),
        "utf8",
      );
      assert.match(config, /const workspaceRoot = path\.resolve\(appRoot, "\.\.\/\.\.\/\.\."\);/);
      assert.match(config, /server:\s*\{[\s\S]*fs:\s*\{[\s\S]*allow:\s*\[workspaceRoot\]/m);
      assert.match(config, /spec\.startsWith\("workspace:"\)/);
      assert.match(config, /spec\.startsWith\("link:"\)/);
      assert.match(config, /spec\.startsWith\("file:"\)/);
      assert.match(config, /optimizeDeps:\s*\{[\s\S]*exclude:\s*optimizeDepsExclude/m);
      assert.match(config, /ssr:\s*\{[\s\S]*noExternal:\s*optimizeDepsExclude/m);
      assert.match(packageJson, /"dev":\s*"node scripts\/dev\.mjs"/);
      assert.match(packageJson, /"dev:wasm:watch":\s*"node scripts\/dev-wasm-watch\.mjs"/);
      assert.match(devScript, /dev-with-wasm-watch\.ts/);
      assert.match(watchScript, /watch-wasm-coordinator\.ts/);
      assert.doesNotMatch(wasmContract, /topWasmUrl/);
      assert.match(wasmContract, /entry\.sourcePath/);
    });
  },
);

test(
  "webapp-ssr-vite dev applies local TS dependency edits for client and server paths",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-vite-hmr-local-dep", async (tmp, _$) => {
      await runSsrViteLocalTsDepTest(tmp, _$);
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
