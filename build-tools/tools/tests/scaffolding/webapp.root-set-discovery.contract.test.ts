#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { sanitizeName } from "../../lib/sanitize.ts";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../../scaffolding/webapp-module-manifests.ts";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { runInTemp } from "../lib/test-helpers";

test("PR-6 root-set discovery picks up new module files without TARGETS edits", async () => {
  await runInTemp("webapp-root-set-discovery-contract", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`scaf new ts webapp-static demo-web --yes --no-tests`;
    const appAbs = path.join(tmp, "projects", "apps", "demo-web");
    const paths = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });

    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });

    const newTsRel = "src/ts-modules/features/new-message.ts";
    const newWasmProducerRel = "src/wasm-producer/new-filter.txt";
    await fsp.mkdir(path.join(appAbs, "src", "ts-modules", "features"), { recursive: true });
    await fsp.mkdir(path.join(appAbs, "src", "wasm-producer"), { recursive: true });
    await fsp.writeFile(
      path.join(appAbs, newTsRel),
      "export const moduleMessage = () => 'root-set-discovery';\n",
      "utf8",
    );
    await fsp.writeFile(path.join(appAbs, newWasmProducerRel), "payload-root-set", "utf8");

    await sleep(1100);
    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });

    const wasmManifest = parseWasmModuleManifest(
      JSON.parse(await fsp.readFile(paths.wasmManifestPath, "utf8")),
      "root-set-wasm",
    );
    const tsManifest = parseTsModuleManifest(
      JSON.parse(await fsp.readFile(paths.tsManifestPath, "utf8")),
      "root-set-ts",
    );

    const expectedTsKey = sanitizeName("src/ts-modules/features/new-message");
    const expectedWasmKey = `${sanitizeName("src/wasm-producer/new-filter")}-contract`;
    const relaxedWasmKey = `${sanitizeName("new-filter")}-contract`;
    assert.ok(tsManifest.modules.some((m) => m.moduleKey === expectedTsKey));
    assert.ok(
      wasmManifest.modules.some(
        (m) =>
          [expectedWasmKey, relaxedWasmKey].includes(m.moduleKey) &&
          m.sourcePath.endsWith("/new-filter.wasm") &&
          m.runtimeDestinations.client === "wasm/new-filter.wasm" &&
          m.runtimeDestinations.server === "server/wasm/new-filter.wasm",
      ),
    );

    await sleep(1100);
    await fsp.writeFile(path.join(appAbs, "README.md"), `touch-${Date.now()}\n`, "utf8");
    const statWasmBeforeReadme = await fsp.stat(paths.wasmManifestPath);
    const statTsBeforeReadme = await fsp.stat(paths.tsManifestPath);
    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });
    const statWasm2 = await fsp.stat(paths.wasmManifestPath);
    const statTs2 = await fsp.stat(paths.tsManifestPath);
    assert.equal(statWasm2.mtimeMs, statWasmBeforeReadme.mtimeMs);
    assert.equal(statTs2.mtimeMs, statTsBeforeReadme.mtimeMs);

    const unchangedWasmMtime = statWasm2.mtimeMs;
    const unchangedTsMtime = statTs2.mtimeMs;
    await sleep(1100);
    await syncModuleContractsForApp({
      appCwd: appAbs,
      root: tmp,
      appTargetLabel: paths.appTargetLabel,
    });
    const statWasm3 = await fsp.stat(paths.wasmManifestPath);
    const statTs3 = await fsp.stat(paths.tsManifestPath);
    assert.equal(statWasm3.mtimeMs, unchangedWasmMtime);
    assert.equal(statTs3.mtimeMs, unchangedTsMtime);
  });
});
