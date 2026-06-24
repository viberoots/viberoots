#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFlagStr } from "../lib/cli";
import { resolveModuleContractsPaths } from "./module-contract-paths";
import { syncModuleContractsForApp } from "./sync-module-contracts-core";
import { findRepoRoot } from "../lib/repo";
import {
  specsFromWasmManifest,
  validateTsManifestProbes,
  type WasmModuleSpec,
} from "./wasm-watch-manifest";
import {
  computeFingerprintMap,
  copyAtomically,
  mapsEqual,
  refreshTriggerPaths,
  runBuildStep,
  type Fingerprint,
} from "./watch-wasm-producer-ops";
import { computeTaskKey, type CoordinatorLease } from "./wasm-watch-coordinator-types";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function ensureDaemon(root: string, pollMs: number): Promise<void> {
  const baseDir = path.join(root, "buck-out", "tmp", "wasm-watch-coordinator");
  const pidPath = path.join(baseDir, "daemon.pid");
  const lockDir = path.join(baseDir, "daemon.start.lock");
  await fsp.mkdir(baseDir, { recursive: true });
  const toolDir = path.dirname(fileURLToPath(import.meta.url));
  const daemonScript = path.join(toolDir, "wasm-watch-coordinator-daemon.ts");
  const daemonDeps = [
    daemonScript,
    path.join(toolDir, "watch-wasm-producer-ops.ts"),
    path.join(toolDir, "wasm-watch-coordinator-types.ts"),
  ];
  let daemonCodeMtime = 0;
  for (const dep of daemonDeps) {
    const st = await fsp.stat(dep).catch(() => null);
    if (st) daemonCodeMtime = Math.max(daemonCodeMtime, st.mtimeMs);
  }
  const pidText = await fsp.readFile(pidPath, "utf8").catch(() => "");
  const pid = Number((JSON.parse(pidText || "{}")?.pid || 0) as number);
  const startedAtRaw = String(JSON.parse(pidText || "{}")?.startedAt || "");
  const startedAtMs = Number.isFinite(Date.parse(startedAtRaw)) ? Date.parse(startedAtRaw) : 0;
  if (pid > 0) {
    try {
      process.kill(pid, 0);
      if (daemonCodeMtime > 0 && startedAtMs > 0 && daemonCodeMtime > startedAtMs) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      } else {
        return;
      }
    } catch {}
  }
  try {
    await fsp.mkdir(lockDir);
  } catch {
    return;
  }
  try {
    const child = spawn("zx-wrapper", [daemonScript, "--root", root, "--poll-ms", String(pollMs)], {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } finally {
    await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

function leaseFromSpecs(args: {
  appId: string;
  leaseId: string;
  cwd: string;
  specs: Awaited<ReturnType<typeof specsFromWasmManifest>>;
}): CoordinatorLease {
  return {
    schemaVersion: 1,
    appId: args.appId,
    leaseId: args.leaseId,
    updatedAtMs: Date.now(),
    subscriptions: args.specs.map((spec) => ({
      taskKey: computeTaskKey({
        moduleType: "wasm",
        buildCommand: spec.buildCommand,
        watchPaths: spec.watchPaths,
      }),
      moduleKey: spec.moduleKey,
      moduleType: "wasm",
      buildCommand: spec.buildCommand,
      buildCwd: args.cwd,
      buildOut: spec.buildOut,
      watchPaths: spec.watchPaths,
      syncOuts: uniqueSorted([spec.syncOut, ...(spec.extraSyncOuts || [])]),
    })),
  };
}

async function runCoordinatorBuild(args: {
  cwd: string;
  spec: WasmModuleSpec;
  seq: number;
  reason: string;
}): Promise<void> {
  const startedAt = Date.now();
  console.error(
    `[wasm-watch] rebuild:start seq=${args.seq} module_type=${args.spec.moduleType} module_key=${args.spec.moduleKey} reason=${args.reason}`,
  );
  try {
    await runBuildStep(args.spec.buildCommand, args.cwd);
    const syncOuts = [args.spec.syncOut, ...(args.spec.extraSyncOuts || [])];
    let copiedSize = 0;
    for (const outPath of syncOuts) {
      copiedSize = await copyAtomically(args.spec.buildOut, outPath);
    }
    console.error(
      `[wasm-watch] sync:ok seq=${args.seq} module_type=${args.spec.moduleType} module_key=${args.spec.moduleKey} bytes=${copiedSize} elapsed_ms=${Date.now() - startedAt} out=${syncOuts.join(",")}`,
    );
  } catch (err) {
    console.error(
      `[wasm-watch] rebuild:fail seq=${args.seq} module_type=${args.spec.moduleType} module_key=${args.spec.moduleKey} elapsed_ms=${Date.now() - startedAt}`,
    );
    console.error(err instanceof Error ? err.message : String(err));
    console.error(`[wasm-watch] recovery: run this command manually:\n${args.spec.buildCommand}`);
    throw err;
  }
}

async function runInitialBuilds(
  cwd: string,
  specs: Awaited<ReturnType<typeof specsFromWasmManifest>>,
): Promise<number> {
  let seq = 0;
  for (const spec of specs) {
    seq += 1;
    await runCoordinatorBuild({ cwd, spec, seq, reason: "startup" });
  }
  return seq;
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const pollMs = Math.max(100, Number(getFlagStr("poll-ms", "300")));
  const refreshThrottleMs = Math.max(500, Number(getFlagStr("refresh-throttle-ms", "1200")));
  const appTarget = getFlagStr("app-target", "");
  const root = await findRepoRoot(cwd);
  const resolved = resolveModuleContractsPaths({
    appCwd: cwd,
    appTargetLabel: appTarget || undefined,
    root,
  });
  await syncModuleContractsForApp({
    appCwd: cwd,
    appTargetLabel: resolved.appTargetLabel,
    root: resolved.repoRoot,
  });
  const baseDir = path.join(resolved.repoRoot, "buck-out", "tmp", "wasm-watch-coordinator");
  const leasesDir = path.join(baseDir, "leases");
  await fsp.mkdir(leasesDir, { recursive: true });
  const leaseId = `${resolved.appId}-${process.pid}`;
  const leasePath = path.join(leasesDir, `${leaseId}.json`);
  const writeLease = async (specs: Awaited<ReturnType<typeof specsFromWasmManifest>>) => {
    const lease = leaseFromSpecs({ appId: resolved.appId, leaseId, cwd, specs });
    await fsp.writeFile(leasePath, JSON.stringify(lease, null, 2) + "\n", "utf8");
  };
  const removeLease = async () => {
    await fsp.rm(leasePath, { force: true }).catch(() => {});
  };

  process.once("SIGINT", () => {
    void removeLease().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void removeLease().finally(() => process.exit(143));
  });

  let specs = await specsFromWasmManifest(cwd, resolved.wasmManifestPath);
  const probeLogs = await validateTsManifestProbes(cwd, resolved.tsManifestPath);
  for (const line of probeLogs) console.error(line);
  let baseRefreshPaths = uniqueSorted([
    resolved.wasmManifestPath,
    resolved.tsManifestPath,
    path.join(cwd, "TARGETS"),
    path.join(cwd, "package.json"),
    path.join(resolved.repoRoot, "build-tools", "tools", "buck", "graph.json"),
  ]);
  let refreshState = await computeFingerprintMap(refreshTriggerPaths(baseRefreshPaths, specs));
  let lastRefreshAt = 0;
  const prevByModule = new Map<string, Map<string, Fingerprint>>();
  for (const spec of specs) {
    prevByModule.set(spec.moduleKey, await computeFingerprintMap(spec.watchPaths));
  }
  let buildSeq = await runInitialBuilds(cwd, specs);
  const refreshCoordinatorState = async () => {
    await syncModuleContractsForApp({
      appCwd: cwd,
      appTargetLabel: resolved.appTargetLabel,
      root: resolved.repoRoot,
    });
    const prevKeys = new Set(prevByModule.keys());
    specs = await specsFromWasmManifest(cwd, resolved.wasmManifestPath);
    const nextKeys = new Set(specs.map((spec) => spec.moduleKey));
    const removed = Array.from(prevKeys).filter((key) => !nextKeys.has(key));
    for (const key of removed) {
      prevByModule.delete(key);
    }
    const nextProbe = await validateTsManifestProbes(cwd, resolved.tsManifestPath);
    for (const line of nextProbe) console.error(line);
    baseRefreshPaths = uniqueSorted([
      resolved.wasmManifestPath,
      resolved.tsManifestPath,
      path.join(cwd, "TARGETS"),
      path.join(cwd, "package.json"),
      path.join(resolved.repoRoot, "build-tools", "tools", "buck", "graph.json"),
    ]);
    refreshState = await computeFingerprintMap(refreshTriggerPaths(baseRefreshPaths, specs));
    for (const spec of specs) {
      if (prevByModule.has(spec.moduleKey)) continue;
      prevByModule.set(spec.moduleKey, await computeFingerprintMap(spec.watchPaths));
      buildSeq += 1;
      await runCoordinatorBuild({ cwd, spec, seq: buildSeq, reason: "refresh:add" });
    }
    await writeLease(specs);
    console.error(`[wasm-watch] coordinator:refresh modules=${specs.length}`);
    return { removed };
  };
  await ensureDaemon(resolved.repoRoot, pollMs);
  await writeLease(specs);
  console.error(
    `[wasm-watch] coordinator:registered app_target=${resolved.appTargetLabel} app_id=${resolved.appId} modules=${specs.length}`,
  );
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (Date.now() - lastRefreshAt >= refreshThrottleMs) {
      const nextRefresh = await computeFingerprintMap(refreshTriggerPaths(baseRefreshPaths, specs));
      if (!mapsEqual(refreshState, nextRefresh)) {
        await refreshCoordinatorState();
      } else {
        await fsp.utimes(leasePath, new Date(), new Date()).catch(() => {});
      }
      lastRefreshAt = Date.now();
    }
    for (const spec of specs) {
      const prev = prevByModule.get(spec.moduleKey) || new Map<string, Fingerprint>();
      const next = await computeFingerprintMap(spec.watchPaths);
      if (!mapsEqual(prev, next)) {
        if (Array.from(next.values()).some((fingerprint) => fingerprint.size < 0)) {
          const nextRefresh = await computeFingerprintMap(
            refreshTriggerPaths(baseRefreshPaths, specs),
          );
          if (!mapsEqual(refreshState, nextRefresh)) {
            const { removed } = await refreshCoordinatorState();
            lastRefreshAt = Date.now();
            if (removed.includes(spec.moduleKey)) continue;
          }
        }
        prevByModule.set(spec.moduleKey, next);
        buildSeq += 1;
        console.error(
          `[wasm-watch] source-change module_type=${spec.moduleType} module_key=${spec.moduleKey}`,
        );
        await runCoordinatorBuild({ cwd, spec, seq: buildSeq, reason: "source-change" });
      }
    }
    await ensureDaemon(resolved.repoRoot, pollMs);
    const prev = await fsp.readFile(leasePath, "utf8").catch(() => "");
    const parsed = prev ? (JSON.parse(prev) as CoordinatorLease) : null;
    if (!parsed || parsed.updatedAtMs + refreshThrottleMs < Date.now()) {
      await writeLease(specs);
    }
  }
}

main().catch((err) => {
  console.error("[wasm-watch] fatal");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
