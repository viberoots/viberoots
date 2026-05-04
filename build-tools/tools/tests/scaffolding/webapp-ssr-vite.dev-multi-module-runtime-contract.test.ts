#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { runInTemp } from "../lib/test-helpers";
import { waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import { stopServer } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-ssr-vite runtime contract supports generated multi-module manifests",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-vite-multi-module-runtime-contract", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      const libAbs = path.join(tmp, "projects", "libs", "demo-lib");
      const appPkgPath = path.join(appAbs, "package.json");
      const libPkgPath = path.join(libAbs, "package.json");
      const topPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const extraPayloadPath = path.join(appAbs, "src", "wasm-producer", "extra.txt");

      const appPkg = JSON.parse(await fsp.readFile(appPkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      appPkg.dependencies = {
        ...(appPkg.dependencies || {}),
        "@libs/demo-lib": "workspace:*",
      };
      await fsp.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n", "utf8");

      const libPkg = JSON.parse(await fsp.readFile(libPkgPath, "utf8")) as Record<string, unknown>;
      const nextLibPkg = {
        ...libPkg,
        exports: { ".": { default: "./src/index.ts" } },
        types: "./src/index.ts",
      };
      await fsp.writeFile(libPkgPath, JSON.stringify(nextLibPkg, null, 2) + "\n", "utf8");

      await fsp.writeFile(topPayloadPath, "top-a", "utf8");
      await fsp.writeFile(extraPayloadPath, "extra-a", "utf8");

      const resolved = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
      await syncModuleContractsForApp({
        appCwd: appAbs,
        root: tmp,
        appTargetLabel: resolved.appTargetLabel,
      });
      const wasmManifest = parseWasmModuleManifest(
        JSON.parse(await fsp.readFile(resolved.wasmManifestPath, "utf8")),
        "ssr-vite-generated-wasm",
      );
      const tsManifest = parseTsModuleManifest(
        JSON.parse(await fsp.readFile(resolved.tsManifestPath, "utf8")),
        "ssr-vite-generated-ts",
      );
      assert.ok(wasmManifest.modules.some((m) => m.moduleKey === "top-contract"));
      assert.ok(wasmManifest.modules.some((m) => m.moduleKey.endsWith("extra-contract")));
      assert.ok(tsManifest.modules.some((m) => m.runtimeImportPath === "@libs/demo-lib"));
      const payloadEntry = wasmManifest.modules.find((m) => m.moduleKey === "top-contract");
      const extraEntry = wasmManifest.modules.find((m) => m.moduleKey.endsWith("extra-contract"));
      assert.ok(payloadEntry);
      assert.ok(extraEntry);
      const payloadWasmPath = path.join(appAbs, payloadEntry!.sourcePath);
      const extraWasmPath = path.join(appAbs, extraEntry!.sourcePath);

      const serverWasmHelper = await fsp.readFile(
        path.join(appAbs, "server", "wasm-contract.ts"),
        "utf8",
      );
      const serverTsHelper = await fsp.readFile(
        path.join(appAbs, "server", "ts-modules.ts"),
        "utf8",
      );
      const buildSsrScript = await fsp.readFile(
        path.join(appAbs, "scripts", "build-ssr.mjs"),
        "utf8",
      );
      assert.doesNotMatch(serverWasmHelper, /server\/wasm-contract\/top\.wasm/);
      assert.match(serverWasmHelper, /readServerWasmModuleByteLength/);
      assert.match(serverWasmHelper, /MODULE_CONTRACTS_DIR/);
      assert.doesNotMatch(serverWasmHelper, /\.\.\/src\/wasm-modules\.manifest\.json/);
      assert.doesNotMatch(serverTsHelper, /const moduleKeys = \["client-entry", "server-entry"\]/);
      assert.match(serverTsHelper, /MODULE_CONTRACTS_DIR/);
      assert.doesNotMatch(serverTsHelper, /\.\.\/src\/ts-modules\.manifest\.json/);
      assert.match(buildSsrScript, /for \(const entry of wasmManifest\.modules \|\| \[\]\)/);
      assert.match(buildSsrScript, /sync-module-contracts\.ts --cwd \. --print-json 1/);

      const logs: string[] = [];
      const watcher = spawn(
        "zx-wrapper",
        [
          "../../../build-tools/tools/dev/watch-wasm-coordinator.ts",
          "--cwd",
          appAbs,
          "--poll-ms",
          "120",
        ],
        { cwd: appAbs, stdio: "pipe", env: process.env },
      );
      watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        await waitForValue(
          async () => await fsp.readFile(payloadWasmPath, "utf8"),
          (v) => v.includes("wasm-producer:top-a"),
        );
        await waitForValue(
          async () => await fsp.readFile(extraWasmPath, "utf8"),
          (v) => v.includes("wasm-producer:extra-a"),
          20000,
          150,
        );

        await writeAndBumpMtime(topPayloadPath, "top-b");
        await writeAndBumpMtime(extraPayloadPath, "extra-b");

        await waitForValue(
          async () => await fsp.readFile(payloadWasmPath, "utf8"),
          (v) => v.includes("wasm-producer:top-b"),
        );
        await waitForValue(
          async () => await fsp.readFile(extraWasmPath, "utf8"),
          (v) => v.includes("wasm-producer:extra-b"),
          20000,
          150,
        );

        const merged = logs.join("");
        assert.match(merged, /\[wasm-watch\] coordinator:registered .* modules=2/);
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
