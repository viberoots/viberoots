#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import {
  parseWasmModuleManifest,
  type WasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests.ts";
import { runInTemp } from "../lib/test-helpers";
import { waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import { stopServer } from "./lib/webapp-static-hmr";
import { removeDefaultWasmFiles, toZeroWasmTargets } from "./lib/zero-wasm";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function readWasmManifest(manifestPath: string): Promise<WasmModuleManifest> {
  return parseWasmModuleManifest(
    JSON.parse(await fsp.readFile(manifestPath, "utf8")),
    manifestPath,
  );
}

test(
  "PR-7 zero-wasm to multi-wasm growth: first wasm module is picked up without target rewiring",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-zero-to-multi-wasm-growth", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const targetsPath = path.join(appAbs, "TARGETS");
      const targetsRaw = await fsp.readFile(targetsPath, "utf8");
      await fsp.writeFile(
        targetsPath,
        toZeroWasmTargets(targetsRaw, { keepWasmRoots: true }),
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
      const zeroManifest = await readWasmManifest(contracts.wasmManifestPath);
      assert.equal(zeroManifest.modules.length, 0);

      const firstProducerRel = "src/wasm-producer/first.txt";
      const firstContractRel = "src/wasm-contract/first.wasm";
      await fsp.writeFile(path.join(appAbs, firstProducerRel), "first-a", "utf8");
      await syncModuleContractsForApp({
        appCwd: appAbs,
        appTargetLabel: contracts.appTargetLabel,
        root: tmp,
      });

      const grownManifest = await waitForValue(
        async () => await readWasmManifest(contracts.wasmManifestPath),
        (manifest) => manifest.modules.some((entry) => entry.sourcePath === firstContractRel),
        15000,
        200,
      );
      assert.ok(grownManifest.modules.some((entry) => entry.sourcePath === firstContractRel));

      const watcher = spawn(
        "zx-wrapper",
        [
          path.join(process.cwd(), "build-tools", "tools", "dev", "watch-wasm-producer.ts"),
          "--cwd",
          appAbs,
        ],
        { cwd: appAbs, stdio: "pipe", env: process.env },
      );
      try {
        await waitForValue(
          async () => {
            try {
              return await fsp.readFile(path.join(appAbs, firstContractRel), "utf8");
            } catch {
              return "";
            }
          },
          (body) => body.includes("first-a"),
          30000,
          300,
        );
        await writeAndBumpMtime(path.join(appAbs, firstProducerRel), "first-b");
        const nextContractBody = await waitForValue(
          async () => await fsp.readFile(path.join(appAbs, firstContractRel), "utf8"),
          (body) => body.includes("first-b"),
          30000,
          300,
        );
        assert.match(nextContractBody, /first-b/);
      } finally {
        await stopServer(watcher);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
