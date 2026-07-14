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
import { pnpmInstallForDevTest, spawnStaticViteDevServer } from "./lib/dev-node-modules";
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

async function waitForSourceContains(
  url: string,
  expected: string,
  devServer: ChildProcess,
  expectedPid: number | undefined,
  logs: string[],
  timeoutMs = 60000,
): Promise<{ status: number; body: string }> {
  const start = Date.now();
  let lastStatus = 0;
  let lastBody = "";
  while (Date.now() - start < timeoutMs) {
    assertNoProcessRestart(devServer, expectedPid);
    const res = await httpGet(url);
    lastStatus = res.status;
    lastBody = res.body;
    if (res.status === 200 && res.body.includes(expected)) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const logsTail = logs.join("").slice(-8000);
  throw new Error(
    [
      `timed out waiting for source '${expected}' after ${timeoutMs}ms`,
      `url=${url}`,
      `last status=${lastStatus}`,
      `last body tail:\n${lastBody.slice(-2000)}`,
      `dev logs tail:\n${logsTail}`,
    ].join("\n\n"),
  );
}

test(
  "wasm runtime authority (static): dependency growth works in one dev session without entrypoint or script edits",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-wasm-runtime-authority-static", async (tmp, _$) => {
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
      await reconcileTempDependencyInputs(tmp, $);
      await pnpmInstallForDevTest({
        tmp,
        _$,
        filter: "./projects/apps/demo-web...",
        frozenLockfile: true,
      });

      const port = await pickFreePort();
      const logs: string[] = [];
      const devServer: ChildProcess = spawnStaticViteDevServer(appAbs, port);
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
              "wasm-authority-static-ts",
            ),
          (manifest) =>
            manifest.modules.some((entry) => entry.runtimeImportPath === "@libs/demo-lib"),
          30000,
          200,
        );
        const wasmManifest = parseWasmModuleManifest(
          JSON.parse(await fsp.readFile(wasmManifestPath, "utf8")),
          "wasm-authority-static-wasm",
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
            return await httpGet(depSourceUrl);
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

        const nextClientModule = await waitForSourceContains(
          `${depSourceUrl}?v=${Date.now()}`,
          "dep-b",
          devServer,
          pid,
          logs,
          60000,
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
