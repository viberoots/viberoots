#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { parseTsModuleManifest } from "../../scaffolding/webapp-module-manifests";
import { runInTemp } from "../lib/test-helpers";

test("PR-7 module-surface dependency growth: adding workspace TS dep updates TS module contract", async () => {
  await runInTemp("webapp-module-surface-dependency-growth", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
    await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;
    const appAbs = path.join(tmp, "projects", "apps", "demo-web");
    const libAbs = path.join(tmp, "projects", "libs", "demo-lib");
    const appPkgPath = path.join(appAbs, "package.json");
    const libPkgPath = path.join(libAbs, "package.json");
    const libEntryPath = path.join(libAbs, "src", "index.ts");

    const appPkg = JSON.parse(await fsp.readFile(appPkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    appPkg.dependencies = { ...(appPkg.dependencies || {}), "@libs/demo-lib": "workspace:*" };
    await fsp.writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n", "utf8");

    const libPkg = JSON.parse(await fsp.readFile(libPkgPath, "utf8")) as Record<string, unknown>;
    await fsp.writeFile(
      libPkgPath,
      JSON.stringify(
        {
          ...libPkg,
          exports: { ".": { default: "./src/index.ts" } },
          types: "./src/index.ts",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      libEntryPath,
      'export const moduleMessage = (): string => "dep-growth";\n',
      "utf8",
    );

    const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
    await syncModuleContractsForApp({
      appCwd: appAbs,
      appTargetLabel: contracts.appTargetLabel,
      root: tmp,
    });
    const tsManifest = parseTsModuleManifest(
      JSON.parse(await fsp.readFile(contracts.tsManifestPath, "utf8")),
      "module-surface-dependency-growth",
    );
    const depModule = tsManifest.modules.find(
      (entry) => entry.runtimeImportPath === "@libs/demo-lib",
    );
    assert.ok(depModule, "expected generated TS manifest entry for workspace dependency");
    assert.match(depModule!.sourceEntryPath, /demo-lib\/src\/index\.ts$/);
  });
});
