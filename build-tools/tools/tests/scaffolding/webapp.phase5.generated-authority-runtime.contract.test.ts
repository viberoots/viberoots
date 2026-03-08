#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { parseWasmModuleManifest } from "../../scaffolding/webapp-module-manifests.ts";
import { runInTemp } from "../lib/test-helpers";
import { runNodeEval } from "./lib/module-runtime-eval";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function readServerWasmModules(
  appAbs: string,
  helperRel: string,
  contractsDir = "",
): Promise<string[]> {
  const helperAbs = path.join(appAbs, helperRel);
  const out = await runNodeEval(
    appAbs,
    [
      'import { pathToFileURL } from "node:url";',
      "const helper = await import(pathToFileURL(process.argv[1]).href + `?t=${Date.now()}`);",
      "const value = helper.listWasmModules();",
      "process.stdout.write(JSON.stringify(value));",
    ].join("\n"),
    [helperAbs],
    contractsDir ? { MODULE_CONTRACTS_DIR: contractsDir } : {},
  );
  return JSON.parse(out) as string[];
}

test(
  "PR-9 generated-authority runtime contract: MODULE_CONTRACTS_DIR is authoritative when set",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-phase5-generated-authority-runtime", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests --skip-lockfile-gen`;

      const scenarios = [
        {
          appAbs: path.join(tmp, "projects", "apps", "demo-vite-ssr"),
          serverHelper: "server/wasm-contract.ts",
          localManifest: "src/wasm-modules.manifest.json",
          payloadFile: path.join("src", "wasm-producer", "payload.txt"),
        },
        {
          appAbs: path.join(tmp, "projects", "apps", "demo-next-ssr"),
          serverHelper: "server/wasm-contract.ts",
          localManifest: "app/wasm-modules.manifest.json",
          payloadFile: path.join("app", "wasm-producer", "payload.txt"),
        },
      ];

      for (const scenario of scenarios) {
        const payloadAbs = path.join(scenario.appAbs, scenario.payloadFile);
        await fsp.mkdir(path.dirname(payloadAbs), { recursive: true });
        await fsp.writeFile(payloadAbs, "phase5-generated-authority", "utf8");
        const contracts = resolveModuleContractsPaths({ appCwd: scenario.appAbs, root: tmp });
        await syncModuleContractsForApp({
          appCwd: scenario.appAbs,
          appTargetLabel: contracts.appTargetLabel,
          root: tmp,
        });
        const wasmManifest = parseWasmModuleManifest(
          JSON.parse(await fsp.readFile(contracts.wasmManifestPath, "utf8")),
          "phase5-generated-authority-runtime",
        );
        const moduleKey = wasmManifest.defaultModuleKey || wasmManifest.modules[0]?.moduleKey || "";
        assert.ok(moduleKey, "expected default wasm module key");

        const localManifestAbs = path.join(scenario.appAbs, scenario.localManifest);
        await fsp.writeFile(localManifestAbs, "{ not-valid-json", "utf8");

        const fromGenerated = await readServerWasmModules(
          scenario.appAbs,
          scenario.serverHelper,
          contracts.contractsDir,
        );
        assert.ok(fromGenerated.includes(moduleKey));

        await assert.rejects(
          async () => await readServerWasmModules(scenario.appAbs, scenario.serverHelper),
          /WASM module manifest is missing/,
        );
      }
    });
  },
);
