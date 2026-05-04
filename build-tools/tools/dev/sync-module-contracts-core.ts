#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { collectDeps } from "../lib/node-deps-enforcement-core";
import { toPosixPath } from "../lib/posix-path";
import { getImporterRootsContract } from "../lib/importer-roots";
import { sanitizeName } from "../lib/sanitize";
import { writeIfChanged } from "../lib/fs-helpers";
import { resolveModuleContractsPaths, type ModuleContractsPaths } from "./module-contract-paths";
import {
  mergeWasmEntries,
  wasmEntriesFromTargets,
  type WasmEntry,
} from "./module-contract-wasm-targets";
import {
  assetStageMetadataFromTargets,
  discoverTsModulesFromRoots,
  tsModuleRootsFromTargets,
  discoverWasmModulesFromRoots,
} from "./module-surface-discovery";
import { moduleSurfaceRootsFromGraph } from "./module-surface-graph";

type TsEntry = { moduleKey: string; sourceEntryPath: string; runtimeImportPath: string };

async function exists(abs: string): Promise<boolean> {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function readJson(abs: string): Promise<any> {
  try {
    return JSON.parse(await fsp.readFile(abs, "utf8"));
  } catch (e) {
    throw new Error(`[module-contracts:E_JSON_READ] failed to read ${abs}: ${String(e)}`);
  }
}

async function appTsEntries(appAbs: string): Promise<TsEntry[]> {
  const candidates: Array<[string, string, string]> = [
    ["default-message", "src/ts-modules/default.ts", "./ts-modules/default"],
    ["client-entry", "src/entry-client.ts", "./entry-client"],
    ["server-entry", "src/entry-server.ts", "./entry-server"],
    ["app-page", "app/page.tsx", "./page"],
    ["server-runtime", "server/index.ts", "../server/index"],
  ];
  const out: TsEntry[] = [];
  for (const [moduleKey, sourceEntryPath, runtimeImportPath] of candidates) {
    if (await exists(path.join(appAbs, sourceEntryPath))) {
      out.push({ moduleKey, sourceEntryPath, runtimeImportPath });
    }
  }
  return out;
}

async function workspaceNameToDir(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const base of getImporterRootsContract().workspaceRoots) {
    const absBase = path.join(root, base);
    let children: string[] = [];
    try {
      children = await fsp.readdir(absBase);
    } catch {
      children = [];
    }
    for (const c of children) {
      const importerAbs = path.join(absBase, c);
      const pkgPath = path.join(importerAbs, "package.json");
      if (!(await exists(pkgPath))) continue;
      const pkg = await readJson(pkgPath);
      const name = String(pkg?.name || "").trim();
      if (!name || out.has(name)) continue;
      out.set(name, importerAbs);
    }
  }
  return out;
}

async function depEntryFromPkg(appAbs: string, depName: string, depAbs: string): Promise<TsEntry> {
  const depPkg = await readJson(path.join(depAbs, "package.json"));
  const candidateFields = [depPkg?.source, depPkg?.module, depPkg?.types, depPkg?.main]
    .filter((v) => typeof v === "string" && String(v).trim() !== "")
    .map((v) => toPosixPath(String(v)));
  const fallback = ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx"];
  const tried = [...candidateFields, ...fallback];
  for (const rel of tried) {
    const clean = rel.replace(/^\.\//, "");
    const abs = path.join(depAbs, clean);
    if (!(await exists(abs))) continue;
    return {
      moduleKey: sanitizeName(depName),
      sourceEntryPath: toPosixPath(path.relative(appAbs, abs)),
      runtimeImportPath: depName,
    };
  }
  throw new Error(
    `[module-contracts:E_TS_DEP_ENTRY] cannot resolve TS entry for workspace dependency '${depName}'`,
  );
}

async function tsEntries(root: string, appAbs: string, appPkg: any): Promise<TsEntry[]> {
  const out = await appTsEntries(appAbs);
  const nameToDir = await workspaceNameToDir(root);
  for (const dep of collectDeps(appPkg)) {
    if (
      !String(dep.spec || "")
        .trim()
        .startsWith("workspace:")
    )
      continue;
    const depAbs = nameToDir.get(dep.name);
    if (!depAbs) {
      throw new Error(
        `[module-contracts:E_TS_WORKSPACE_DEP] workspace dependency '${dep.name}' has no local package`,
      );
    }
    out.push(await depEntryFromPkg(appAbs, dep.name, depAbs));
  }
  const byKey = new Map<string, TsEntry>();
  for (const e of out) {
    if (byKey.has(e.moduleKey) && byKey.get(e.moduleKey)?.sourceEntryPath !== e.sourceEntryPath) {
      throw new Error(`[module-contracts:E_TS_DUP_KEY] duplicate TS module key '${e.moduleKey}'`);
    }
    byKey.set(e.moduleKey, e);
  }
  return Array.from(byKey.values()).sort((a, b) => a.moduleKey.localeCompare(b.moduleKey));
}

function mergeTsEntries(base: TsEntry[], discovered: TsEntry[]): TsEntry[] {
  const byKey = new Map<string, TsEntry>();
  const bySource = new Map<string, TsEntry>();
  for (const entry of [...base, ...discovered]) {
    if (bySource.has(entry.sourceEntryPath)) continue;
    const prev = byKey.get(entry.moduleKey);
    if (
      prev &&
      (prev.sourceEntryPath !== entry.sourceEntryPath ||
        prev.runtimeImportPath !== entry.runtimeImportPath)
    ) {
      throw new Error(
        `[module-contracts:E_TS_DUP_KEY] duplicate TS module key '${entry.moduleKey}'`,
      );
    }
    byKey.set(entry.moduleKey, entry);
    bySource.set(entry.sourceEntryPath, entry);
  }
  return Array.from(byKey.values()).sort((a, b) => a.moduleKey.localeCompare(b.moduleKey));
}

function manifestJson(version: number, defaultModuleKey: string, modules: any[]): string {
  return JSON.stringify({ schemaVersion: version, defaultModuleKey, modules }, null, 2) + "\n";
}

export async function syncModuleContractsForApp(args: {
  appCwd: string;
  appTargetLabel?: string;
  root?: string;
}): Promise<ModuleContractsPaths> {
  const paths = resolveModuleContractsPaths(args);
  const appAbs = path.resolve(args.appCwd);
  const targetsPath = path.join(appAbs, "TARGETS");
  const pkgPath = path.join(appAbs, "package.json");
  const targetsText = await fsp.readFile(targetsPath, "utf8").catch((e) => {
    throw new Error(
      `[module-contracts:E_TARGETS_READ] failed reading ${targetsPath}: ${String(e)}`,
    );
  });
  const appPkg = await readJson(pkgPath);
  const appStageTargetName = paths.appTargetLabel.split(":").pop() || "app";
  const requireServerDestination = await exists(path.join(appAbs, "server", "wasm-contract.ts"));
  const stageMetadata = assetStageMetadataFromTargets(targetsText, appStageTargetName);
  let graphSurfaceData =
    (await moduleSurfaceRootsFromGraph({
      repoRoot: paths.repoRoot,
      appTargetLabel: paths.appTargetLabel,
    }).catch(() => null)) || null;
  if (!graphSurfaceData) {
    // Hermetic/pure builders can legitimately lack refresh capabilities (for example buck2).
    // Use TARGETS-derived roots so contract generation remains deterministic in primary builds.
    graphSurfaceData = {
      tsRoots: tsModuleRootsFromTargets(targetsText),
      wasmRoots: stageMetadata.wasmModuleRoots,
      appLabels: stageMetadata.labels,
    };
  }
  let wasmModules = wasmEntriesFromTargets(
    targetsText,
    appStageTargetName,
    requireServerDestination,
  );
  wasmModules = mergeWasmEntries(
    wasmModules,
    await discoverWasmModulesFromRoots(
      appAbs,
      graphSurfaceData.wasmRoots,
      graphSurfaceData.appLabels,
    ),
  );
  const tsModules = mergeTsEntries(
    await tsEntries(paths.repoRoot, appAbs, appPkg),
    await discoverTsModulesFromRoots(appAbs, graphSurfaceData.tsRoots),
  );
  if (tsModules.length === 0)
    throw new Error(
      "[module-contracts:E_TS_EMPTY] no TS module entries discovered from package.json/workspace sources",
    );
  const wasmDefault =
    wasmModules.find((m) => m.moduleKey === "top-contract")?.moduleKey ||
    wasmModules[0]?.moduleKey ||
    "";
  const tsDefault =
    tsModules.find((m) => ["default-message", "client-entry", "app-page"].includes(m.moduleKey))
      ?.moduleKey || tsModules[0]!.moduleKey;
  const wasmManifestText = manifestJson(1, wasmDefault, wasmModules);
  const tsManifestText = manifestJson(1, tsDefault, tsModules);
  await fsp.mkdir(paths.contractsDir, { recursive: true });
  await writeIfChanged(paths.wasmManifestPath, wasmManifestText);
  await writeIfChanged(paths.tsManifestPath, tsManifestText);
  const manifestDir = graphSurfaceData.appLabels.includes("framework:next")
    ? path.join(appAbs, "app")
    : path.join(appAbs, "src");
  if (await exists(manifestDir)) {
    await fsp.mkdir(manifestDir, { recursive: true });
    await writeIfChanged(path.join(manifestDir, "wasm-modules.manifest.json"), wasmManifestText);
    await writeIfChanged(path.join(manifestDir, "ts-modules.manifest.json"), tsManifestText);
  }
  return paths;
}
