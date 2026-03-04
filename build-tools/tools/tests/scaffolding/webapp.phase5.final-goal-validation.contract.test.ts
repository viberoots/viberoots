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
import { runInTemp } from "../lib/test-helpers";
import {
  readTsModuleMessageViaHelper,
  readWasmByteLengthViaHelper,
} from "./lib/module-runtime-eval";
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

function addExtraWasmAssets(targetsRaw: string): string {
  const anchor = `        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},\n`;
  const extra = [
    `        {"src": "src/wasm-contract/extra.wasm", "dest": "client/extra.wasm"},`,
    `        {"src": "src/wasm-contract/extra.wasm", "dest": "server/wasm-contract/extra.wasm"},`,
  ].join("\n");
  return targetsRaw.replace(anchor, `${anchor}${extra}\n`);
}

test(
  "Phase-5 PR-5 final goal validation: dependency growth works in one dev session without app-entrypoint edits",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-phase5-final-goal-validation", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests`;
      await $`scaf new ts lib demo-lib --yes --no-tests`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      const libAbs = path.join(tmp, "projects", "libs", "demo-lib");
      const appPkgPath = path.join(appAbs, "package.json");
      const libPkgPath = path.join(libAbs, "package.json");
      const libSourcePath = path.join(libAbs, "src", "index.ts");
      const targetsPath = path.join(appAbs, "TARGETS");
      const topPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const extraPayloadPath = path.join(appAbs, "src", "wasm-producer", "extra.txt");
      const extraWasmPath = path.join(appAbs, "src", "wasm-contract", "extra.wasm");
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

      const targetsRaw = await fsp.readFile(targetsPath, "utf8");
      await fsp.writeFile(targetsPath, addExtraWasmAssets(targetsRaw), "utf8");
      await fsp.writeFile(topPayloadPath, "top-a", "utf8");
      await fsp.writeFile(extraPayloadPath, "extra-a", "utf8");
      await fsp.writeFile(extraWasmPath, "wasm-producer:extra-a", "utf8");

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-vite-ssr projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-vite-ssr --filter ./projects/libs/demo-lib --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const logs: string[] = [];
      const devServer: ChildProcess = spawn("pnpm", ["run", "dev"], {
        cwd: appAbs,
        stdio: "pipe",
        env: { ...process.env, PORT: String(port), NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1" },
      });
      devServer.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      devServer.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
        const pid = devServer.pid;
        const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
        const tsManifestPath = contracts.tsManifestPath;
        const wasmManifestPath = contracts.wasmManifestPath;

        const tsManifest = await waitForValue(
          async () =>
            parseTsModuleManifest(
              JSON.parse(await fsp.readFile(tsManifestPath, "utf8")),
              "phase5-final-goal-ts",
            ),
          (manifest) =>
            manifest.modules.some((entry) => entry.runtimeImportPath === "@libs/demo-lib"),
          30000,
          200,
        );
        const wasmManifest = await waitForValue(
          async () =>
            parseWasmModuleManifest(
              JSON.parse(await fsp.readFile(wasmManifestPath, "utf8")),
              "phase5-final-goal-wasm",
            ),
          (manifest) => manifest.modules.some((entry) => entry.moduleKey === "extra-contract"),
          30000,
          200,
        );
        assertNoProcessRestart(devServer, pid);

        assert.equal(await fsp.readFile(clientEntryPath, "utf8"), baselineClientEntry);
        assert.equal(await fsp.readFile(serverEntryPath, "utf8"), baselineServerEntry);

        const depModule = tsManifest.modules.find(
          (entry) => entry.runtimeImportPath === "@libs/demo-lib",
        );
        assert.ok(depModule, "expected generated TS module key for @libs/demo-lib");
        const extraWasm = wasmManifest.modules.find(
          (entry) => entry.moduleKey === "extra-contract",
        );
        assert.ok(extraWasm, "expected generated wasm module key extra-contract");

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
          async () => await httpGet(depSourceUrl),
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
          async () => await httpGet(`http://127.0.0.1:${port}/src/wasm-contract/extra.wasm`),
          (res) => res.status === 200 && res.body.includes("wasm-producer:extra-bbb"),
          30000,
          300,
        );
        assert.equal(clientExtraWasm.status, 200);

        const expectedServerBytes = Buffer.byteLength("wasm-producer:extra-bbb", "utf8");
        const serverExtraBytes = await waitForValue(
          async () =>
            await readWasmByteLengthViaHelper(
              appAbs,
              "server/wasm-contract.ts",
              "extra-contract",
              contracts.contractsDir,
            ),
          (bytes) => bytes === expectedServerBytes,
          30000,
          300,
        );
        assert.equal(serverExtraBytes, expectedServerBytes);
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
