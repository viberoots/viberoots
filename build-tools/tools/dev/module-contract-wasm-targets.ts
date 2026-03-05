#!/usr/bin/env zx-wrapper
import path from "node:path";
import { toPosixPath } from "../lib/posix-path.ts";
import { sanitizeName } from "../lib/sanitize.ts";

export type WasmEntry = {
  moduleKey: string;
  sourcePath: string;
  runtimeDestinations: { client: string; server: string };
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
