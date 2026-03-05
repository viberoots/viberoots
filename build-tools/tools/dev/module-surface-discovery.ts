#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize.ts";
import { toPosixPath } from "../lib/posix-path.ts";

export type AssetStageMetadata = {
  wasmModuleRoots: string[];
  labels: string[];
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listAttr(block: string, attr: string): string[] {
  const raw =
    block.match(new RegExp(`${escapeRegExp(attr)}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"))?.[1] || "";
  return Array.from(raw.matchAll(/"([^"]+)"/g))
    .map((m) => m[1] || "")
    .filter(Boolean);
}

function appBlock(targetsText: string): string {
  return targetsText.match(/node_webapp\s*\([\s\S]*?\)\s*/m)?.[0] || "";
}

export function tsModuleRootsFromTargets(targetsText: string): string[] {
  const roots = listAttr(appBlock(targetsText), "ts_module_roots");
  return roots.length > 0 ? roots : ["src/ts-modules"];
}

export function assetStageMetadataFromTargets(
  targetsText: string,
  appStageTargetName: string,
): AssetStageMetadata {
  const block =
    targetsText.match(
      new RegExp(
        `node_asset_stage\\s*\\([\\s\\S]*?name\\s*=\\s*"${escapeRegExp(appStageTargetName)}"[\\s\\S]*?\\)\\s*`,
        "m",
      ),
    )?.[0] || "";
  const labels = listAttr(block, "labels");
  const wasmModuleRoots = listAttr(block, "wasm_module_roots");
  if (wasmModuleRoots.length > 0) {
    return { wasmModuleRoots, labels };
  }
  // Zero-wasm templates omit explicit roots by default. Keep first-module growth zero-edit by
  // inferring canonical roots from framework labels.
  if (labels.includes("framework:next")) {
    return { wasmModuleRoots: ["app/wasm-producer"], labels };
  }
  return { wasmModuleRoots: ["src/wasm-producer"], labels };
}

function moduleKeyFromRelativeNoExt(relativeNoExt: string, suffix: string): string {
  const key = sanitizeName(relativeNoExt);
  if (!key) {
    throw new Error(`[module-contracts:E_DISCOVERY_KEY] invalid module key for '${relativeNoExt}'`);
  }
  return `${key}${suffix}`;
}

async function walkFiles(absRoot: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [absRoot];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const entries = await fsp.readdir(cur, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next")
          continue;
        queue.push(abs);
        continue;
      }
      if (entry.isFile()) out.push(abs);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export async function discoverTsModulesFromRoots(
  appAbs: string,
  roots: string[],
): Promise<Array<{ moduleKey: string; sourceEntryPath: string; runtimeImportPath: string }>> {
  const out: Array<{ moduleKey: string; sourceEntryPath: string; runtimeImportPath: string }> = [];
  for (const root of roots) {
    const rootAbs = path.join(appAbs, root);
    const files = await walkFiles(rootAbs);
    for (const abs of files) {
      const rel = toPosixPath(path.relative(appAbs, abs));
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      const relNoExt = rel.replace(/\.(ts|tsx)$/, "");
      const moduleKey =
        rel === "src/ts-modules/default.ts"
          ? "default-message"
          : rel === "src/entry-client.ts"
            ? "client-entry"
            : rel === "src/entry-server.ts"
              ? "server-entry"
              : rel === "app/page.tsx"
                ? "app-page"
                : rel === "server/index.ts"
                  ? "server-runtime"
                  : moduleKeyFromRelativeNoExt(relNoExt, "");
      const runtimeImportPath = rel.startsWith("server/")
        ? `../${relNoExt}`
        : rel.startsWith("src/")
          ? `./${relNoExt.slice("src/".length)}`
          : rel.startsWith("app/")
            ? `./${relNoExt.slice("app/".length)}`
            : `./${path.posix.basename(relNoExt)}`;
      out.push({ moduleKey, sourceEntryPath: rel, runtimeImportPath });
    }
  }
  return out;
}

export async function discoverWasmModulesFromRoots(
  appAbs: string,
  roots: string[],
  _labels: string[],
): Promise<
  Array<{
    moduleKey: string;
    sourcePath: string;
    runtimeDestinations: { client: string; server: string };
  }>
> {
  const out: Array<{
    moduleKey: string;
    sourcePath: string;
    runtimeDestinations: { client: string; server: string };
  }> = [];
  for (const root of roots) {
    const rootAbs = path.join(appAbs, root);
    const files = await walkFiles(rootAbs);
    for (const abs of files) {
      const rel = toPosixPath(path.relative(appAbs, abs));
      if (!/\.(txt|go|c|cc|cpp|cxx|py|rs)$/.test(rel)) continue;
      const relNoExt = rel.replace(/\.[^.]+$/, "");
      const rootPosix = toPosixPath(root).replace(/\/+$/, "");
      const relFromRoot = toPosixPath(path.relative(rootAbs, abs)).replace(/\.[^.]+$/, "");
      const moduleStem = relFromRoot === "payload" ? "top" : relFromRoot;
      const contractRoot = rootPosix.includes("wasm-producer")
        ? rootPosix.replace(/wasm-producer/g, "wasm-contract")
        : `${rootPosix}/../wasm-contract`;
      const sourcePath = toPosixPath(path.posix.normalize(`${contractRoot}/${moduleStem}.wasm`));
      const basename = path.posix.basename(sourcePath, ".wasm");
      out.push({
        moduleKey: moduleKeyFromRelativeNoExt(moduleStem, "-contract"),
        sourcePath,
        runtimeDestinations: {
          client: `wasm/${basename}.wasm`,
          server: `server/wasm/${basename}.wasm`,
        },
      });
    }
  }
  return out;
}
