#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getFlagStr } from "../lib/cli.ts";
import { runManagedCommand } from "../lib/managed-command.ts";
import { resolveModuleContractsPaths } from "./module-contract-paths.ts";
import { syncModuleContractsForApp } from "./sync-module-contracts-core.ts";
import {
  legacySpecFromFlags,
  specsFromWasmManifest,
  type WasmModuleSpec,
  validateTsManifestProbes,
} from "./wasm-watch-manifest.ts";

type Fingerprint = { mtimeMs: number; size: number };

function required(name: string, value: string): string {
  const v = String(value || "").trim();
  if (!v) throw new Error(`missing required flag --${name}`);
  return v;
}

async function fileFingerprint(absPath: string): Promise<Fingerprint> {
  try {
    const st = await fsp.stat(absPath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { mtimeMs: 0, size: -1 };
  }
}

async function computeFingerprintMap(paths: string[]): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  for (const p of paths) out.set(p, await fileFingerprint(p));
  return out;
}

function mapsEqual(a: Map<string, Fingerprint>, b: Map<string, Fingerprint>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, av] of a.entries()) {
    const bv = b.get(k);
    if (!bv) return false;
    if (av.mtimeMs !== bv.mtimeMs || av.size !== bv.size) return false;
  }
  return true;
}

async function runBuildStep(buildCommand: string, cwd: string): Promise<void> {
  const result = await runManagedCommand({
    command: "/bin/bash",
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

async function copyAtomically(src: string, dst: string): Promise<number> {
  const srcStat = await fsp.stat(src);
  const dstDir = path.dirname(dst);
  await fsp.mkdir(dstDir, { recursive: true });
  const tmp = path.join(dstDir, `.${path.basename(dst)}.tmp-${process.pid}-${Date.now()}`);
  await fsp.copyFile(src, tmp);
  await fsp.rename(tmp, dst);
  return srcStat.size;
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const pollMs = Math.max(100, Number(getFlagStr("poll-ms", "300")));
  let wasmManifest = getFlagStr("wasm-manifest", "");
  let tsManifest = getFlagStr("ts-manifest", "");
  const appTarget = getFlagStr("app-target", "");
  const watchRaw = getFlagStr("watch", "");
  const buildCmdRaw = getFlagStr("build-cmd", "");
  const buildOutRaw = getFlagStr("build-out", "");
  const syncOutRaw = getFlagStr("sync-out", "");
  const moduleKeyRaw = getFlagStr("module-key", "top-contract") || "top-contract";
  const hasLegacyFlags = [watchRaw, buildCmdRaw, buildOutRaw, syncOutRaw].some(
    (value) => String(value || "").trim() !== "",
  );

  if (!wasmManifest && !tsManifest && !hasLegacyFlags) {
    const resolved = resolveModuleContractsPaths({
      appCwd: cwd,
      appTargetLabel: appTarget || undefined,
    });
    await syncModuleContractsForApp({
      appCwd: cwd,
      appTargetLabel: resolved.appTargetLabel,
      root: resolved.repoRoot,
    });
    console.error(
      `[module-contracts] sync:ok app_target=${resolved.appTargetLabel} app_id=${resolved.appId} out=${resolved.contractsDir}`,
    );
    wasmManifest = resolved.wasmManifestPath;
    tsManifest = resolved.tsManifestPath;
    console.error(
      `[wasm-watch] contracts:generated app_target=${resolved.appTargetLabel} app_id=${resolved.appId} dir=${resolved.contractsDir}`,
    );
  }
  const specs = wasmManifest
    ? await specsFromWasmManifest(cwd, wasmManifest)
    : [
        legacySpecFromFlags(cwd, {
          watchRaw: required("watch", watchRaw),
          buildCommand: required("build-cmd", buildCmdRaw),
          buildOut: required("build-out", buildOutRaw),
          syncOut: required("sync-out", syncOutRaw),
          moduleKey: moduleKeyRaw,
        }),
      ];
  if (wasmManifest) {
    console.error(
      `[wasm-watch] manifest:wasm modules=${specs.length} path=${path.relative(cwd, path.resolve(cwd, wasmManifest)) || "."}`,
    );
  }
  if (tsManifest) {
    const probeLogs = await validateTsManifestProbes(cwd, tsManifest);
    for (const line of probeLogs) console.error(line);
  }

  const byKey = new Map(specs.map((spec) => [spec.moduleKey, spec]));
  const prevByModule = new Map<string, Map<string, Fingerprint>>();
  for (const spec of specs)
    prevByModule.set(spec.moduleKey, await computeFingerprintMap(spec.watchPaths));
  const pending = new Map<string, string>();
  const pendingCoalesced = new Map<string, number>();
  let buildSeq = 0;
  let running = false;
  let roundRobinStart = 0;

  const queueBuild = (moduleKey: string, reason: string) => {
    if (pending.has(moduleKey)) {
      pendingCoalesced.set(moduleKey, (pendingCoalesced.get(moduleKey) || 0) + 1);
    }
    pending.set(moduleKey, reason);
  };
  const pickNextPendingKey = (): string | null => {
    for (let offset = 0; offset < specs.length; offset += 1) {
      const idx = (roundRobinStart + offset) % specs.length;
      const key = specs[idx]?.moduleKey;
      if (key && pending.has(key)) {
        roundRobinStart = (idx + 1) % specs.length;
        return key;
      }
    }
    return null;
  };
  const runQueuedBuilds = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.size > 0) {
        const moduleKey = pickNextPendingKey();
        if (!moduleKey) break;
        const spec = byKey.get(moduleKey);
        if (!spec) continue;
        const reason = pending.get(moduleKey) || "unknown";
        pending.delete(moduleKey);
        buildSeq += 1;
        const seq = buildSeq;
        const startedAt = Date.now();
        console.error(
          `[wasm-watch] rebuild:start seq=${seq} module_type=${spec.moduleType} module_key=${moduleKey} reason=${reason}`,
        );
        try {
          await runBuildStep(spec.buildCommand, cwd);
          const copiedSize = await copyAtomically(spec.buildOut, spec.syncOut);
          const elapsed = Date.now() - startedAt;
          console.error(
            `[wasm-watch] sync:ok seq=${seq} module_type=${spec.moduleType} module_key=${moduleKey} bytes=${copiedSize} elapsed_ms=${elapsed} out=${spec.syncOut}`,
          );
        } catch (err) {
          const elapsed = Date.now() - startedAt;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[wasm-watch] rebuild:fail seq=${seq} module_type=${spec.moduleType} module_key=${moduleKey} elapsed_ms=${elapsed}`,
          );
          console.error(msg);
          console.error(`[wasm-watch] recovery: run this command manually:\n${spec.buildCommand}`);
        }
      }
    } finally {
      running = false;
    }
  };

  console.error(`[wasm-watch] start module_count=${specs.length} poll_ms=${pollMs} concurrency=1`);
  for (const spec of specs) queueBuild(spec.moduleKey, "startup");
  await runQueuedBuilds();

  for (;;) {
    await sleep(pollMs);
    for (const spec of specs) {
      const prev = prevByModule.get(spec.moduleKey) || new Map<string, Fingerprint>();
      const next = await computeFingerprintMap(spec.watchPaths);
      if (!mapsEqual(prev, next)) {
        prevByModule.set(spec.moduleKey, next);
        queueBuild(spec.moduleKey, "source-change");
      }
    }
    await runQueuedBuilds();
    for (const [moduleKey, count] of pendingCoalesced.entries()) {
      if (count > 0) {
        console.error(`[wasm-watch] queue:coalesced module_key=${moduleKey} count=${count}`);
      }
    }
    pendingCoalesced.clear();
  }
}

main().catch((err) => {
  console.error("[wasm-watch] fatal");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
