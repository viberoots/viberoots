#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { parseWasmModuleManifest } from "../../scaffolding/webapp-module-manifests";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { pnpmInstallForDevTest, spawnViteSsrDevServer } from "./lib/dev-node-modules";
import { pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";
import { removeDefaultWasmFiles, toZeroWasmTargets } from "./lib/zero-wasm";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "zero-wasm default (ssr-vite): install, build, and dev stay healthy without wasm modules",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-zero-wasm-default-ssr-vite", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite --yes --no-tests --skip-store-hash-refresh`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-vite");
      const targetsPath = path.join(appAbs, "TARGETS");
      const targetsRaw = await fsp.readFile(targetsPath, "utf8");
      await fsp.writeFile(
        targetsPath,
        toZeroWasmTargets(targetsRaw, { keepWasmRoots: false }),
        "utf8",
      );
      await removeDefaultWasmFiles(appAbs, {
        producerPayloadRel: "src/wasm-producer/payload.txt",
        contractRel: "src/wasm-contract/top.wasm",
      });
      const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
      await syncModuleContractsForApp({
        appCwd: appAbs,
        appTargetLabel: contracts.appTargetLabel,
        root: tmp,
      });
      const wasmManifest = parseWasmModuleManifest(
        JSON.parse(await fsp.readFile(contracts.wasmManifestPath, "utf8")),
        "zero-wasm-ssr-vite",
      );
      assert.equal(wasmManifest.modules.length, 0);
      assert.equal(wasmManifest.defaultModuleKey, "");
      await reconcileTempDependencyInputs(tmp, _$);
      await pnpmInstallForDevTest({
        tmp,
        _$,
        filter: "./projects/apps/demo-vite...",
        frozenLockfile: true,
      });
      await _$({ cwd: appAbs, stdio: "inherit" })`node scripts/build-ssr.mjs`;

      const port = await pickFreePort();
      const devServer: ChildProcess = spawnViteSsrDevServer(appAbs, port);
      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
      } finally {
        await stopServer(devServer);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
