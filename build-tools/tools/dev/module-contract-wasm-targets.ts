#!/usr/bin/env zx-wrapper
import path from "node:path";
import { toPosixPath } from "../lib/posix-path.ts";
import { sanitizeName } from "../lib/sanitize.ts";

export type WasmEntry = {
  moduleKey: string;
  sourcePath: string;
  runtimeDestinations: { client: string; server: string };
  sourceLabel?: string;
  sourceWatchPaths?: string[];
};

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
  if (!block) {
    throw new Error(
      `[module-contracts:E_TARGETS_MISSING_APP] missing node_asset_stage(name='${appStageTargetName}')`,
    );
  }
  const assetsRaw = block.match(/assets\s*=\s*\[([\s\S]*?)\]/m)?.[1] || "";
  const out: Array<{ src: string; dest: string }> = [];
  const entryRe = /\{\s*"src"\s*:\s*"([^"]+)"\s*,\s*"dest"\s*:\s*"([^"]+)"\s*\}/g;
  for (const m of assetsRaw.matchAll(entryRe)) out.push({ src: m[1] || "", dest: m[2] || "" });
  return out;
}

export function wasmEntriesFromTargets(
  targetsText: string,
  appStageTargetName: string,
  requireServerDestination: boolean,
): WasmEntry[] {
  const bySrc = new Map<
    string,
    { client: Set<string>; server: Set<string>; sourceLabel: string; sourceWatchPaths: string[] }
  >();
  const sourcePathForClientDest = (dest: string): string => {
    const clean = toPosixPath(dest).replace(/^dist\//, "");
    const basename = path.posix.basename(clean);
    if (clean.startsWith("client/public/")) return `app/wasm-contract/${basename}`;
    return `src/wasm-contract/${basename}`;
  };
  const sourceWatchPathsForLabel = (srcLabel: string): string[] => {
    const normalized = toPosixPath(srcLabel);
    if (!normalized.startsWith("//") || !normalized.includes(":")) return [];
    const pkg = normalized.slice(2).split(":")[0] || "";
    if (!pkg) return [];
    return [`${pkg}/TARGETS`, `${pkg}/src`];
  };
  for (const asset of parseAssetEntries(targetsText, appStageTargetName)) {
    const src = toPosixPath(asset.src);
    const dest = toPosixPath(asset.dest);
    const labelLike = src.startsWith("//") || src.startsWith(":");
    const sourceKey = labelLike ? src : src.endsWith(".wasm") ? src : "";
    if (!sourceKey || !dest.endsWith(".wasm")) continue;
    if (!bySrc.has(sourceKey)) {
      bySrc.set(sourceKey, {
        client: new Set(),
        server: new Set(),
        sourceLabel: labelLike ? src : "",
        sourceWatchPaths: labelLike ? sourceWatchPathsForLabel(src) : [],
      });
    }
    const slots = bySrc.get(sourceKey)!;
    if (dest.startsWith("server/")) slots.server.add(dest);
    else slots.client.add(dest);
  }
  const entries: WasmEntry[] = [];
  for (const src of Array.from(bySrc.keys()).sort((a, b) => a.localeCompare(b))) {
    const slots = bySrc.get(src)!;
    const client = Array.from(slots.client).sort((a, b) => a.localeCompare(b))[0] || "";
    const server = Array.from(slots.server).sort((a, b) => a.localeCompare(b))[0] || "";
    const sourcePath = slots.sourceLabel ? sourcePathForClientDest(client) : src;
    const moduleKey = sanitizeName(`${path.posix.basename(sourcePath, ".wasm")}-contract`);
    const resolvedServer = server || (requireServerDestination ? "" : client);
    if (!moduleKey || !client || !resolvedServer) {
      throw new Error(
        `[module-contracts:E_WASM_ASSET_CONTRACT] invalid wasm asset wiring for '${src}' (need both client and server destinations)`,
      );
    }
    entries.push({
      moduleKey,
      sourcePath,
      runtimeDestinations: { client, server: resolvedServer },
      sourceLabel: slots.sourceLabel || undefined,
      sourceWatchPaths: slots.sourceWatchPaths.length > 0 ? slots.sourceWatchPaths : undefined,
    });
  }
  return entries;
}

export function mergeWasmEntries(base: WasmEntry[], discovered: WasmEntry[]): WasmEntry[] {
  const bySource = new Map<string, WasmEntry>();
  const byKey = new Map<string, WasmEntry>();
  for (const entry of [...base, ...discovered]) {
    const prev = byKey.get(entry.moduleKey);
    if (prev && prev.sourcePath !== entry.sourcePath) {
      throw new Error(
        `[module-contracts:E_WASM_DUP_KEY] duplicate wasm module key '${entry.moduleKey}'`,
      );
    }
    if (bySource.has(entry.sourcePath)) continue;
    bySource.set(entry.sourcePath, entry);
    byKey.set(entry.moduleKey, entry);
  }
  return Array.from(bySource.values()).sort((a, b) => a.moduleKey.localeCompare(b.moduleKey));
}
