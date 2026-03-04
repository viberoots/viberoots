#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests.ts";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { runInTemp } from "../lib/test-helpers";

test("PR-2 generated manifests are deterministic and refresh on TARGETS changes", async () => {
  await runInTemp("webapp-generated-manifest-contract", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`scaf new ts webapp-static demo-web --yes --no-tests`;

    const appAbs = path.join(tmp, "projects", "apps", "demo-web");
    const paths = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });

    const wasmRaw1 = await fsp.readFile(paths.wasmManifestPath, "utf8");
    const tsRaw1 = await fsp.readFile(paths.tsManifestPath, "utf8");
    const wasm1 = parseWasmModuleManifest(JSON.parse(wasmRaw1), "wasm-1");
    const ts1 = parseTsModuleManifest(JSON.parse(tsRaw1), "ts-1");
    assert.equal(wasm1.defaultModuleKey, "top-contract");
    assert.ok(ts1.modules.length >= 1);

    const wasmStat1 = await fsp.stat(paths.wasmManifestPath);
    const tsStat1 = await fsp.stat(paths.tsManifestPath);
    await sleep(1100);
    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });
    const wasmStat2 = await fsp.stat(paths.wasmManifestPath);
    const tsStat2 = await fsp.stat(paths.tsManifestPath);
    assert.equal(wasmStat1.mtimeMs, wasmStat2.mtimeMs, "wasm manifest should be no-op unchanged");
    assert.equal(tsStat1.mtimeMs, tsStat2.mtimeMs, "ts manifest should be no-op unchanged");

    const targetsPath = path.join(appAbs, "TARGETS");
    const targetsRaw = await fsp.readFile(targetsPath, "utf8");
    const patch = `        {"src": "src/wasm-contract/extra.wasm", "dest": "extra.wasm"},\n        {"src": "src/wasm-contract/extra.wasm", "dest": "server/wasm-contract/extra.wasm"},\n`;
    const updated = targetsRaw.replace(
      `        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},\n`,
      `        {"src": "src/wasm-contract/top.wasm", "dest": "server/wasm-contract/top.wasm"},\n${patch}`,
    );
    await fsp.writeFile(targetsPath, updated, "utf8");
    await fsp.writeFile(path.join(appAbs, "src", "wasm-contract", "extra.wasm"), "extra", "utf8");

    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });
    const wasmRaw2 = await fsp.readFile(paths.wasmManifestPath, "utf8");
    const wasm2 = parseWasmModuleManifest(JSON.parse(wasmRaw2), "wasm-2");
    assert.ok(wasm2.modules.some((m) => m.moduleKey === "extra-contract"));
  });
});
