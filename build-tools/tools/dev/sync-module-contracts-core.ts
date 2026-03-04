#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { collectDeps } from "../lib/node-deps-enforcement-core.ts";
import { toPosixPath } from "../lib/posix-path.ts";
import { getImporterRootsContract } from "../lib/importer-roots.ts";
import { sanitizeName } from "../lib/sanitize.ts";
import { writeIfChanged } from "../lib/fs-helpers.ts";
import { resolveModuleContractsPaths, type ModuleContractsPaths } from "./module-contract-paths.ts";

type WasmEntry = {
  moduleKey: string;
  sourcePath: string;
  runtimeDestinations: { client: string; server: string };
};
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAssetEntries(
  targetsText: string,
  appStageTargetName: string,
): Array<{ src: string; dest: string }> {
  const block = targetsText.match(
    new RegExp(
      `node_asset_stage\\s*\\([\\s\\S]*?name\\s*=\\s*"${escapeRegExp(appStageTargetName)}"[\\s\\S]*?\\)\\s*`,
      "m",
    ),
  )?.[0];
  if (!block)
    throw new Error(
      `[module-contracts:E_TARGETS_MISSING_APP] missing node_asset_stage(name='${appStageTargetName}')`,
    );
  const assetsRaw = block.match(/assets\s*=\s*\[([\s\S]*?)\]/m)?.[1] || "";
  const out: Array<{ src: string; dest: string }> = [];
  const entryRe = /\{\s*"src"\s*:\s*"([^"]+)"\s*,\s*"dest"\s*:\s*"([^"]+)"\s*\}/g;
  for (const m of assetsRaw.matchAll(entryRe)) out.push({ src: m[1], dest: m[2] });
  return out;
}

function wasmEntriesFromTargets(
  targetsText: string,
  appStageTargetName: string,
  requireServerDestination: boolean,
): WasmEntry[] {
  const bySrc = new Map<string, { client: Set<string>; server: Set<string> }>();
  for (const asset of parseAssetEntries(targetsText, appStageTargetName)) {
    const src = toPosixPath(asset.src);
    const dest = toPosixPath(asset.dest);
    if (src.startsWith(":") || !src.endsWith(".wasm")) continue;
    if (!bySrc.has(src)) bySrc.set(src, { client: new Set(), server: new Set() });
    const slots = bySrc.get(src)!;
    if (dest.startsWith("server/")) slots.server.add(dest);
    else slots.client.add(dest);
  }
  const entries: WasmEntry[] = [];
  for (const src of Array.from(bySrc.keys()).sort((a, b) => a.localeCompare(b))) {
    const slots = bySrc.get(src)!;
    const moduleKey = sanitizeName(`${path.posix.basename(src, ".wasm")}-contract`);
    const client = Array.from(slots.client).sort((a, b) => a.localeCompare(b))[0] || "";
    const server = Array.from(slots.server).sort((a, b) => a.localeCompare(b))[0] || "";
    const resolvedServer = server || (requireServerDestination ? "" : client);
    if (!moduleKey || !client || !resolvedServer) {
      throw new Error(
        `[module-contracts:E_WASM_ASSET_CONTRACT] invalid wasm asset wiring for '${src}' (need both client and server destinations)`,
      );
    }
    entries.push({
      moduleKey,
      sourcePath: src,
      runtimeDestinations: { client, server: resolvedServer },
    });
  }
  return entries;
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
  let wasmModules = wasmEntriesFromTargets(
    targetsText,
    appStageTargetName,
    requireServerDestination,
  );
  if (wasmModules.length === 0) {
    const conventionalWasmRel = "src/wasm-contract/top.wasm";
    if (await exists(path.join(appAbs, conventionalWasmRel)))
      wasmModules = [
        {
          moduleKey: "top-contract",
          sourcePath: conventionalWasmRel,
          runtimeDestinations: { client: "top.wasm", server: "top.wasm" },
        },
      ];
  }
  if (wasmModules.length === 0) {
    throw new Error(
      "[module-contracts:E_WASM_EMPTY] no wasm module entries discovered from TARGETS or conventional src/wasm-contract/top.wasm",
    );
  }
  const tsModules = await tsEntries(paths.repoRoot, appAbs, appPkg);
  if (tsModules.length === 0)
    throw new Error(
      "[module-contracts:E_TS_EMPTY] no TS module entries discovered from package.json/workspace sources",
    );
  const wasmDefault = wasmModules[0]!.moduleKey;
  const tsDefault =
    tsModules.find((m) => ["default-message", "client-entry", "app-page"].includes(m.moduleKey))
      ?.moduleKey || tsModules[0]!.moduleKey;
  await fsp.mkdir(paths.contractsDir, { recursive: true });
  await writeIfChanged(paths.wasmManifestPath, manifestJson(1, wasmDefault, wasmModules));
  await writeIfChanged(paths.tsManifestPath, manifestJson(1, tsDefault, tsModules));
  return paths;
}
