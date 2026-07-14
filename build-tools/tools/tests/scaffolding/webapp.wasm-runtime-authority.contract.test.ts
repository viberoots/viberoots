#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { pnpmInstallForDevTest, spawnViteSsrDevServer } from "./lib/dev-node-modules";
import { readTsModuleMessageViaHelper } from "./lib/module-runtime-eval";
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
const SSR_VITE_DEV_READY_TIMEOUT_MS = 120000;

test(
  "wasm runtime authority: dependency growth works in one dev session without app-entrypoint edits",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-wasm-runtime-authority", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      const libAbs = path.join(tmp, "projects", "libs", "demo-lib");
      const appPkgPath = path.join(appAbs, "package.json");
      const libPkgPath = path.join(libAbs, "package.json");
      const libSourcePath = path.join(libAbs, "src", "index.ts");
      const topPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const extraPayloadPath = path.join(appAbs, "src", "wasm-producer", "extra.txt");
      const clientEntryPath = path.join(appAbs, "src", "entry-client.ts");
      const serverEntryPath = path.join(appAbs, "src", "entry-server.ts");

      const baselineClientEntry = await fsp.readFile(clientEntryPath, "utf8");
      const baselineServerEntry = await fsp.readFile(serverEntryPath, "utf8");

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
      })`git add -A projects/apps/demo-vite-ssr projects/libs/demo-lib`;
      await reconcileTempDependencyInputs(tmp, $);
      await pnpmInstallForDevTest({
        tmp,
        _$,
        filter: "./projects/apps/demo-vite-ssr...",
        frozenLockfile: true,
      });

      const port = await pickFreePort();
      const logs: string[] = [];
      const devServer: ChildProcess = spawnViteSsrDevServer(appAbs, port);
      devServer.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      devServer.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        try {
          await waitForHttpOk(`http://127.0.0.1:${port}/`, SSR_VITE_DEV_READY_TIMEOUT_MS);
        } catch (error) {
          const joinedLogs = logs.join("").trim();
          const suffix = joinedLogs ? `\n---- dev logs ----\n${joinedLogs}` : "";
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} (exitCode=${String(
              devServer.exitCode,
            )}, signal=${String(devServer.signalCode)})${suffix}`,
          );
        }
        const pid = devServer.pid;
        assertNoProcessRestart(devServer, pid);
        const tsManifestPath = contracts.tsManifestPath;
        const wasmManifestPath = contracts.wasmManifestPath;

        const tsManifest = await waitForValue(
          async () =>
            parseTsModuleManifest(
              JSON.parse(await fsp.readFile(tsManifestPath, "utf8")),
              "wasm-authority-ts",
            ),
          (manifest) =>
            manifest.modules.some((entry) => entry.runtimeImportPath === "@libs/demo-lib"),
          30000,
          200,
        );
        const wasmManifest = parseWasmModuleManifest(
          JSON.parse(await fsp.readFile(wasmManifestPath, "utf8")),
          "wasm-authority-wasm",
        );
        assertNoProcessRestart(devServer, pid);

        assert.equal(await fsp.readFile(clientEntryPath, "utf8"), baselineClientEntry);
        assert.equal(await fsp.readFile(serverEntryPath, "utf8"), baselineServerEntry);

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
        const initialClientModule = await httpGet(depSourceUrl);
        assert.equal(initialClientModule.status, 200);
        assert.match(initialClientModule.body, /dep-a/);
        const initialServerMsg = await readTsModuleMessageViaHelper(
          appAbs,
          "server/ts-modules.ts",
          depModule!.moduleKey,
          contracts.contractsDir,
        );
        assert.equal(initialServerMsg, "dep-a");

        await writeAndBumpMtime(
          libSourcePath,
          'export const moduleMessage = (): string => "dep-b";\n',
        );
        await writeAndBumpMtime(topPayloadPath, "top-bb");
        await writeAndBumpMtime(extraPayloadPath, "extra-bbb");

        const nextClientModule = await waitForValue(
          async () => {
            assertNoProcessRestart(devServer, pid);
            return await httpGet(depSourceUrl);
          },
          (res) => res.status === 200 && res.body.includes("dep-b"),
          30000,
          300,
        );
        const nextServerMsg = await waitForValue(
          async () =>
            await readTsModuleMessageViaHelper(
              appAbs,
              "server/ts-modules.ts",
              depModule!.moduleKey,
              contracts.contractsDir,
            ),
          (value) => value === "dep-b",
          30000,
          300,
        );
        assert.equal(nextClientModule.status, 200);
        assert.equal(nextServerMsg, "dep-b");

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
