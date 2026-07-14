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
import { pnpmInstallForDevTest, spawnNextSsrDevServer } from "./lib/dev-node-modules";
import { pickFreePort, stopServer, waitForChildHttpOk } from "./lib/webapp-static-hmr";
import { removeDefaultWasmFiles, toZeroWasmTargets } from "./lib/zero-wasm";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
const NEXT_DEV_READY_TIMEOUT_MS = Number(
  process.env.NEXT_DEV_READY_TIMEOUT_MS || process.env.NEXT_DEV_UPDATE_TIMEOUT_MS || "180000",
);

test(
  "zero-wasm default (ssr-next): install, build, and dev stay healthy without wasm modules",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-zero-wasm-default-ssr-next", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-next demo-next --yes --no-tests --skip-store-hash-refresh`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-next");
      const targetsPath = path.join(appAbs, "TARGETS");
      const targetsRaw = await fsp.readFile(targetsPath, "utf8");
      await fsp.writeFile(
        targetsPath,
        toZeroWasmTargets(targetsRaw, { keepWasmRoots: false }),
        "utf8",
      );
      await removeDefaultWasmFiles(appAbs, {
        producerPayloadRel: "app/wasm-producer/payload.txt",
        contractRel: "app/wasm-contract/top.wasm",
      });
      const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
      await syncModuleContractsForApp({
        appCwd: appAbs,
        appTargetLabel: contracts.appTargetLabel,
        root: tmp,
      });
      const wasmManifest = parseWasmModuleManifest(
        JSON.parse(await fsp.readFile(contracts.wasmManifestPath, "utf8")),
        "zero-wasm-ssr-next",
      );
      assert.equal(wasmManifest.modules.length, 0);
      assert.equal(wasmManifest.defaultModuleKey, "");
      await reconcileTempDependencyInputs(tmp, $);
      await pnpmInstallForDevTest({
        tmp,
        _$,
        filter: "./projects/apps/demo-next...",
        frozenLockfile: true,
      });
      await _$({ cwd: appAbs, stdio: "inherit" })`node scripts/build-ssr.mjs`;

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const devServer: ChildProcess = spawnNextSsrDevServer(appAbs, port);
      devServer.stdout?.on("data", (chunk) => {
        serverStdout.push(String(chunk || ""));
        if (serverStdout.length > 200) serverStdout.shift();
      });
      devServer.stderr?.on("data", (chunk) => {
        serverStderr.push(String(chunk || ""));
        if (serverStderr.length > 200) serverStderr.shift();
      });
      try {
        await waitForChildHttpOk(devServer, `http://127.0.0.1:${port}/`, NEXT_DEV_READY_TIMEOUT_MS);
      } catch (error) {
        const tailOut = serverStdout.join("").slice(-8000);
        const tailErr = serverStderr.join("").slice(-8000);
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            "runtime diagnostics:",
            `next stdout tail:\n${tailOut}`,
            `next stderr tail:\n${tailErr}`,
          ].join("\n\n"),
        );
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
