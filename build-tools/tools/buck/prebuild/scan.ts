#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  WORKSPACE_PROVIDER_DIR,
} from "../../lib/workspace-state-paths";
import { discoverPrebuildInputs } from "./input-discovery";

export function mtimeSafe(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

export async function listInputs(): Promise<string[]> {
  return await discoverPrebuildInputs();
}

export function listOutputs(): string[] {
  const graphOut = DEFAULT_GRAPH_PATH;
  const nodeLockIdx = DEFAULT_NODE_LOCK_INDEX_PATH;
  const invalidationReport = DEFAULT_INVALIDATION_REPORT_PATH;
  const autoMap = DEFAULT_AUTO_MAP_PATH;
  const outs = [
    graphOut,
    nodeLockIdx,
    invalidationReport,
    autoMap,
    // C++ no longer requires provider→attr mapping; keep only auto_map for Node.
  ];
  try {
    const dir = WORKSPACE_PROVIDER_DIR;
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^TARGETS.*\.auto$/.test(f)) outs.push(path.join(dir, f));
    }
  } catch {}
  return outs;
}

export function listFreshnessOutputs(outputs: string[] = listOutputs()): string[] {
  return outputs.filter(
    (output) => !/^\.viberoots\/workspace\/providers\/TARGETS.*\.auto$/.test(output),
  );
}

export function hasPatchesOrLocks(inputs: string[]): boolean {
  return (
    inputs.some((f) => f.startsWith("patches/") && f.endsWith(".patch")) ||
    inputs.some((f) => f.endsWith("pnpm-lock.yaml")) ||
    inputs.includes("flake.lock") ||
    inputs.some((f) => f.startsWith("build-tools/tools/nix/overlays/"))
  );
}

export function missingProviderAutos(): boolean {
  try {
    const dir = WORKSPACE_PROVIDER_DIR;
    if (!fs.existsSync(dir)) return true;
    return !fs.readdirSync(dir).some((f) => /^TARGETS.*\.auto$/.test(f));
  } catch {
    return true;
  }
}
