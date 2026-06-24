#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { parseWasmModuleManifest } from "../../scaffolding/webapp-module-manifests";
import { runInTemp } from "../lib/test-helpers";
import { pnpmInstallForDevTest, spawnStaticViteDevServer } from "./lib/dev-node-modules";
import { pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";
import { removeDefaultWasmFiles, toZeroWasmTargets } from "./lib/zero-wasm";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "zero-wasm default (static): install, build, and dev stay healthy without wasm modules",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-zero-wasm-default-static", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-store-hash-refresh`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
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
        "zero-wasm-static",
      );
      assert.equal(wasmManifest.modules.length, 0);
      assert.equal(wasmManifest.defaultModuleKey, "");
      await fsp.writeFile(
        path.join(appAbs, "src", "wasm-modules.manifest.json"),
        await fsp.readFile(contracts.wasmManifestPath, "utf8"),
        "utf8",
      );
      await fsp.writeFile(
        path.join(appAbs, "src", "ts-modules.manifest.json"),
        await fsp.readFile(contracts.tsManifestPath, "utf8"),
        "utf8",
      );
      await pnpmInstallForDevTest({
        tmp,
        _$,
        filter: "./projects/apps/demo-web...",
      });
      await _$({ cwd: appAbs, stdio: "inherit" })`node scripts/build.mjs`;

      const port = await pickFreePort();
      const devServer: ChildProcess = spawnStaticViteDevServer(appAbs, port);
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
