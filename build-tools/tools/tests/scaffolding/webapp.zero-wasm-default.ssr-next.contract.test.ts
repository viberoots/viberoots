#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { parseWasmModuleManifest } from "../../scaffolding/webapp-module-manifests.ts";
import { runInTemp } from "../lib/test-helpers";
import { pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";
import { removeDefaultWasmFiles, toZeroWasmTargets } from "./lib/zero-wasm";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-7 zero-wasm default (ssr-next): install, build, and dev stay healthy without wasm modules",
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
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
      })`pnpm --dir ${tmp} install --filter ./projects/apps/demo-next... --frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;
      await _$({ cwd: appAbs, stdio: "inherit" })`pnpm --dir ${appAbs} run build:ssr`;

      const port = await pickFreePort();
      const devServer: ChildProcess = spawn("pnpm", ["run", "dev:ssr"], {
        cwd: appAbs,
        stdio: "pipe",
        env: { ...process.env, PORT: String(port), NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1" },
      });
      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`, 120000);
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
