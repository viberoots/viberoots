#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests.ts";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { runInTemp } from "../lib/test-helpers";
import {
  httpGet,
  pickFreePort,
  stopServer,
  viteFsUrlFor,
  waitForHttpOk,
} from "./lib/webapp-static-hmr";
import { assertNoProcessRestart, waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "Phase-5 PR-5 final goal validation (static): dependency growth works in one dev session without entrypoint or script edits",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-phase5-final-goal-validation-static", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const libAbs = path.join(tmp, "projects", "libs", "demo-lib");
      const appPkgPath = path.join(appAbs, "package.json");
      const libPkgPath = path.join(libAbs, "package.json");
      const libSourcePath = path.join(libAbs, "src", "index.ts");
      const topPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const extraPayloadPath = path.join(appAbs, "src", "wasm-producer", "extra.txt");
      const mainPath = path.join(appAbs, "src", "main.ts");

      const baselineMain = await fsp.readFile(mainPath, "utf8");
      const baselineAppPkg = JSON.parse(await fsp.readFile(appPkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const baselineScripts = { ...(baselineAppPkg.scripts || {}) };

      const appPkg = JSON.parse(await fsp.readFile(appPkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      appPkg.dependencies = { ...(appPkg.dependencies || {}), "@libs/demo-lib": "workspace:*" };
      await fsp.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n", "utf8");

      const libPkg = JSON.parse(await fsp.readFile(libPkgPath, "utf8")) as Record<string, unknown>;
      const nextLibPkg = {
        ...libPkg,
        exports: { ".": { default: "./src/index.ts" } },
        types: "./src/index.ts",
      };
      await fsp.writeFile(libPkgPath, JSON.stringify(nextLibPkg, null, 2) + "\n", "utf8");
      await fsp.writeFile(
        libSourcePath,
        'export const moduleMessage = (): string => "dep-a";\n',
        "utf8",
      );

      await fsp.writeFile(topPayloadPath, "top-a", "utf8");
      await fsp.writeFile(extraPayloadPath, "extra-a", "utf8");
      const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
      await syncModuleContractsForApp({
        appCwd: appAbs,
        appTargetLabel: contracts.appTargetLabel,
        root: tmp,
      });

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-web projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-web... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const logs: string[] = [];
      const devServer: ChildProcess = spawn("pnpm", ["run", "dev"], {
        cwd: appAbs,
        stdio: "pipe",
        env: { ...process.env, PORT: String(port), NODE_OPTIONS: "" },
      });
      devServer.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      devServer.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
        const pid = devServer.pid;
        assertNoProcessRestart(devServer, pid);
        const tsManifestPath = contracts.tsManifestPath;
        const wasmManifestPath = contracts.wasmManifestPath;

        const tsManifest = await waitForValue(
          async () =>
            parseTsModuleManifest(
              JSON.parse(await fsp.readFile(tsManifestPath, "utf8")),
              "phase5-final-goal-static-ts",
            ),
          (manifest) =>
            manifest.modules.some((entry) => entry.runtimeImportPath === "@libs/demo-lib"),
          30000,
          200,
        );
        const wasmManifest = parseWasmModuleManifest(
          JSON.parse(await fsp.readFile(wasmManifestPath, "utf8")),
          "phase5-final-goal-static-wasm",
        );
        assertNoProcessRestart(devServer, pid);

        assert.equal(await fsp.readFile(mainPath, "utf8"), baselineMain);
        const latestScripts =
          (
            JSON.parse(await fsp.readFile(appPkgPath, "utf8")) as {
              scripts?: Record<string, string>;
            }
          ).scripts || {};
        assert.deepEqual(latestScripts, baselineScripts);

        const depModule = tsManifest.modules.find(
          (entry) => entry.runtimeImportPath === "@libs/demo-lib",
        );
        assert.ok(depModule, "expected generated TS module key for @libs/demo-lib");
        const wasmGrowthModule =
          wasmManifest.modules.find((entry) => entry.moduleKey === "extra-contract") ||
          wasmManifest.modules.find((entry) => entry.moduleKey !== wasmManifest.defaultModuleKey) ||
          wasmManifest.modules[0] ||
          null;
        assert.ok(wasmGrowthModule, "expected at least one generated wasm module");
        assert.match(wasmGrowthModule.runtimeDestinations.client, /^wasm\/.+\.wasm$/);
        assert.match(wasmGrowthModule.runtimeDestinations.server, /^server\/wasm\/.+\.wasm$/);

        const canonicalLibSourcePath = await fsp.realpath(libSourcePath);
        const depSourceUrl = `http://127.0.0.1:${port}${viteFsUrlFor(canonicalLibSourcePath)}`;
        const initialClientModule = await waitForValue(
          async () => {
            assertNoProcessRestart(devServer, pid);
            return await httpGet(`${depSourceUrl}?t=${Date.now()}`);
          },
          (res) => res.status === 200 && res.body.includes("dep-a"),
          120000,
          300,
        );
        assert.equal(initialClientModule.status, 200);
        assert.match(initialClientModule.body, /dep-a/);

        await writeAndBumpMtime(
          libSourcePath,
          'export const moduleMessage = (): string => "dep-b";\n',
        );
        await writeAndBumpMtime(topPayloadPath, "top-bb");
        await writeAndBumpMtime(extraPayloadPath, "extra-bbb");

        const nextClientModule = await waitForValue(
          async () => {
            assertNoProcessRestart(devServer, pid);
            return await httpGet(`${depSourceUrl}?t=${Date.now()}`);
          },
          (res) => res.status === 200 && res.body.includes("dep-b"),
          180000,
          700,
        );
        assert.equal(nextClientModule.status, 200);

        const clientExtraWasm = await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/${wasmGrowthModule.sourcePath}`),
          (res) => res.status === 200,
          30000,
          300,
        );
        assert.equal(clientExtraWasm.status, 200);
        assertNoProcessRestart(devServer, pid);
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
