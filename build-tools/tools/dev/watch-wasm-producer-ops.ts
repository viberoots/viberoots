#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runManagedCommand } from "../lib/managed-command";
import { syncModuleContractsForApp } from "./sync-module-contracts-core";
import {
  specsFromWasmManifest,
  type WasmModuleSpec,
  validateTsManifestProbes,
} from "./wasm-watch-manifest";

export type Fingerprint = { mtimeMs: number; size: number };

async function fileFingerprint(absPath: string): Promise<Fingerprint> {
  try {
    const st = await fsp.stat(absPath);
    if (st.isDirectory()) {
      const stack = [absPath];
      let newest = st.mtimeMs;
      let totalSize = 0;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const entries = await fsp.readdir(cur, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const child = path.join(cur, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === ".git" || entry.name === "node_modules") continue;
            stack.push(child);
            continue;
          }
          if (!entry.isFile()) continue;
          const cst = await fsp.stat(child).catch(() => null);
          if (!cst) continue;
          newest = Math.max(newest, cst.mtimeMs);
          totalSize += cst.size;
        }
      }
      return { mtimeMs: newest, size: totalSize };
    }
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { mtimeMs: 0, size: -1 };
  }
}

export async function computeFingerprintMap(paths: string[]): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  for (const p of paths) out.set(p, await fileFingerprint(p));
  return out;
}

export function mapsEqual(a: Map<string, Fingerprint>, b: Map<string, Fingerprint>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a.entries()) {
    const bv = b.get(k);
    if (!bv) return false;
    if (av.mtimeMs !== bv.mtimeMs || av.size !== bv.size) return false;
  }
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function refreshTriggerPaths(basePaths: string[], specs: WasmModuleSpec[]): string[] {
  const watchDirs = specs.map((s) => path.dirname(s.watchPaths[0] || ""));
  return uniqueSorted([...basePaths, ...watchDirs].map((p) => path.resolve(p)));
}

export async function refreshWatcherSpecs(args: {
  cwd: string;
  wasmManifest: string;
  tsManifest: string;
  specs: WasmModuleSpec[];
  generated: { appTargetLabel: string; root: string } | null;
  baseRefreshPaths: string[];
  prevByModule: Map<string, Map<string, Fingerprint>>;
  pending: Map<string, string>;
  pendingCoalesced: Map<string, number>;
  queueBuild: (moduleKey: string, reason: string) => void;
}): Promise<{ specs: WasmModuleSpec[]; refreshState: Map<string, Fingerprint> }> {
  if (args.generated) {
    await syncModuleContractsForApp({
      appCwd: args.cwd,
      appTargetLabel: args.generated.appTargetLabel,
      root: args.generated.root,
    });
  }
  const nextSpecs = await specsFromWasmManifest(args.cwd, args.wasmManifest);
  if (args.tsManifest) {
    const nextTsProbeLogs = await validateTsManifestProbes(args.cwd, args.tsManifest);
    for (const line of nextTsProbeLogs) console.error(line);
  }
  const prevKeys = new Set(args.specs.map((s) => s.moduleKey));
  const nextKeys = new Set(nextSpecs.map((s) => s.moduleKey));
  const removed = Array.from(prevKeys).filter((k) => !nextKeys.has(k));
  const added = Array.from(nextKeys).filter((k) => !prevKeys.has(k));
  const nextByKey = new Map(nextSpecs.map((spec) => [spec.moduleKey, spec]));
  for (const key of removed) {
    args.prevByModule.delete(key);
    args.pending.delete(key);
    args.pendingCoalesced.delete(key);
  }
  for (const key of added) {
    const spec = nextByKey.get(key);
    if (!spec) continue;
    args.prevByModule.set(key, await computeFingerprintMap(spec.watchPaths));
    args.queueBuild(key, "refresh:add");
  }
  const refreshState = await computeFingerprintMap(
    refreshTriggerPaths(args.baseRefreshPaths, nextSpecs),
  );
  console.error(
    `[wasm-watch] refresh:ok module_count=${nextSpecs.length} added=${added.sort().join(",") || "-"} removed=${removed.sort().join(",") || "-"}`,
  );
  return { specs: nextSpecs, refreshState };
}

export async function runBuildStep(buildCommand: string, cwd: string): Promise<void> {
  const shell = String(process.env.BASH || process.env.SHELL || "bash").trim() || "bash";
  const result = await runManagedCommand({
    command: shell,
    args: ["--noprofile", "--norc", "-lc", buildCommand],
    cwd,
    env: process.env,
    timeoutMs: 10 * 60 * 1000,
  });
  if (result.ok) return;
  const stderrTail = String(result.stderr || "").slice(-4000);
  const stdoutTail = String(result.stdout || "").slice(-2000);
  throw new Error(
    [
      `build command failed (code=${String(result.code)} signal=${String(result.signal)})`,
      stderrTail ? `stderr tail:\n${stderrTail}` : "",
      stdoutTail ? `stdout tail:\n${stdoutTail}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

export async function copyAtomically(src: string, dst: string): Promise<number> {
  const srcStat = await fsp.stat(src);
  const dstDir = path.dirname(dst);
  await fsp.mkdir(dstDir, { recursive: true });
  const tmp = path.join(dstDir, `.${path.basename(dst)}.tmp-${process.pid}-${Date.now()}`);
  await fsp.copyFile(src, tmp);
  await fsp.rename(tmp, dst);
  return srcStat.size;
}
