#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFlagStr } from "../lib/cli";
import { resolveModuleContractsPaths } from "./module-contract-paths";
import { syncModuleContractsForApp } from "./sync-module-contracts-core";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { findRepoRoot } from "../lib/repo";
import { specsFromWasmManifest, validateTsManifestProbes } from "./wasm-watch-manifest";
import {
  computeFingerprintMap,
  mapsEqual,
  membershipMapsEqual,
  type Fingerprint,
} from "./watch-wasm-producer-ops";
import { computeTaskKey, type CoordinatorLease } from "./wasm-watch-coordinator-types";
import { readCoordinatorResult } from "./wasm-watch-coordinator-results";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function ensureDaemon(root: string, pollMs: number): Promise<void> {
  const baseDir = path.join(root, "buck-out", "tmp", "wasm-watch-coordinator");
  const pidPath = path.join(baseDir, "daemon.pid");
  const lockDir = path.join(baseDir, "daemon.start.lock");
  await mkdirWithMacosMetadataExclusion(baseDir);
  const toolDir = path.dirname(fileURLToPath(import.meta.url));
  const daemonScript = path.join(toolDir, "wasm-watch-coordinator-daemon.ts");
  const daemonDeps = [
    daemonScript,
    path.join(toolDir, "watch-wasm-producer-ops.ts"),
    path.join(toolDir, "wasm-watch-coordinator-types.ts"),
    path.join(toolDir, "wasm-watch-coordinator-results.ts"),
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
      requestId: crypto.randomUUID(),
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

async function waitForLeaseResults(args: {
  lease: CoordinatorLease;
  resultsDir: string;
  timeoutMs: number;
  lastGeneration: Map<string, number>;
}): Promise<void> {
  const started = Date.now();
  for (;;) {
    let pending = false;
    for (const sub of args.lease.subscriptions) {
      const result = await readCoordinatorResult(args.resultsDir, sub.taskKey);
      if (!result?.requestIds.includes(sub.requestId)) {
        pending = true;
        continue;
      }
      if ((args.lastGeneration.get(sub.taskKey) || 0) < result.generation) {
        console.error(
          `[wasm-watch] rebuild:start seq=${result.generation} module_type=wasm module_key=${sub.moduleKey} reason=${result.reason}`,
        );
        if (result.status === "failure") {
          console.error(
            `[wasm-watch] rebuild:fail seq=${result.generation} module_type=wasm module_key=${sub.moduleKey} elapsed_ms=${result.elapsedMs}`,
          );
          console.error(result.error || "wasm coordinator build failed");
          console.error(`[wasm-watch] recovery: run this command manually:\n${sub.buildCommand}`);
          throw new Error(result.error || `wasm coordinator task failed: ${sub.taskKey}`);
        }
        console.error(
          `[wasm-watch] sync:ok seq=${result.generation} module_type=wasm module_key=${sub.moduleKey} bytes=${result.outputs.reduce((sum, output) => sum + output.size, 0)} elapsed_ms=${result.elapsedMs} out=${result.outputs.map((output) => output.path).join(",")}`,
        );
        args.lastGeneration.set(sub.taskKey, result.generation);
      }
    }
    if (!pending) return;
    if (Date.now() - started >= args.timeoutMs) {
      throw new Error(
        `timed out waiting for wasm coordinator acknowledgement after ${args.timeoutMs}ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
  const resultsDir = path.join(baseDir, "results");
  await mkdirWithMacosMetadataExclusion(leasesDir);
  const leaseId = `${resolved.appId}-${process.pid}`;
  const leasePath = path.join(leasesDir, `${leaseId}.json`);
  const persistLease = async (lease: CoordinatorLease): Promise<void> => {
    const temp = `${leasePath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(lease, null, 2) + "\n", "utf8");
    await fsp.rename(temp, leasePath);
  };
  const writeLease = async (
    specs: Awaited<ReturnType<typeof specsFromWasmManifest>>,
  ): Promise<CoordinatorLease> => {
    const lease = leaseFromSpecs({ appId: resolved.appId, leaseId, cwd, specs });
    await persistLease(lease);
    return lease;
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
  let refreshState = await computeFingerprintMap(baseRefreshPaths);
  let lastRefreshAt = 0;
  const prevByModule = new Map<string, Map<string, Fingerprint>>();
  const membershipChangeByModule = new Map<string, { since: number; refreshAttempted: boolean }>();
  const lastResultGeneration = new Map<string, number>();
  for (const spec of specs) {
    prevByModule.set(spec.moduleKey, await computeFingerprintMap(spec.watchPaths));
  }
  let activeLease: CoordinatorLease;
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
      membershipChangeByModule.delete(key);
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
    refreshState = await computeFingerprintMap(baseRefreshPaths);
    for (const spec of specs) {
      if (prevByModule.has(spec.moduleKey)) continue;
      prevByModule.set(spec.moduleKey, await computeFingerprintMap(spec.watchPaths));
    }
    activeLease = await writeLease(specs);
    await waitForLeaseResults({
      lease: activeLease,
      resultsDir,
      timeoutMs: 600_000,
      lastGeneration: lastResultGeneration,
    });
    console.error(`[wasm-watch] coordinator:refresh modules=${specs.length}`);
    return { removed };
  };
  await ensureDaemon(resolved.repoRoot, pollMs);
  activeLease = await writeLease(specs);
  await waitForLeaseResults({
    lease: activeLease,
    resultsDir,
    timeoutMs: 600_000,
    lastGeneration: lastResultGeneration,
  });
  console.error(
    `[wasm-watch] coordinator:registered app_target=${resolved.appTargetLabel} app_id=${resolved.appId} modules=${specs.length}`,
  );
  console.error(`[wasm-watch] coordinator:ready lease_id=${leaseId}`);
  watchLoop: for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (Date.now() - lastRefreshAt >= refreshThrottleMs) {
      const nextRefresh = await computeFingerprintMap(baseRefreshPaths);
      if (!mapsEqual(refreshState, nextRefresh)) {
        await refreshCoordinatorState();
      } else {
        activeLease.updatedAtMs = Date.now();
        await persistLease(activeLease);
      }
      lastRefreshAt = Date.now();
    }
    for (const spec of specs) {
      const prev = prevByModule.get(spec.moduleKey) || new Map<string, Fingerprint>();
      const next = await computeFingerprintMap(spec.watchPaths);
      const membershipChanged = !membershipMapsEqual(prev, next);
      if (!membershipChanged) membershipChangeByModule.delete(spec.moduleKey);
      if (!mapsEqual(prev, next)) {
        if (membershipChanged) {
          let change = membershipChangeByModule.get(spec.moduleKey);
          if (!change) {
            change = { since: Date.now(), refreshAttempted: false };
            membershipChangeByModule.set(spec.moduleKey, change);
            console.error(
              `[wasm-watch] source-membership-change module_type=${spec.moduleType} module_key=${spec.moduleKey} status=settling`,
            );
            continue;
          }
          if (Date.now() - change.since < refreshThrottleMs) continue;

          if (!change.refreshAttempted) {
            change.refreshAttempted = true;
            await refreshCoordinatorState();
            lastRefreshAt = Date.now();
            continue watchLoop;
          }
        }
        membershipChangeByModule.delete(spec.moduleKey);
        prevByModule.set(spec.moduleKey, next);
      }
    }
    await ensureDaemon(resolved.repoRoot, pollMs);
    await waitForLeaseResults({
      lease: activeLease,
      resultsDir,
      timeoutMs: 600_000,
      lastGeneration: lastResultGeneration,
    });
    const prev = await fsp.readFile(leasePath, "utf8").catch(() => "");
    const parsed = prev ? (JSON.parse(prev) as CoordinatorLease) : null;
    if (!parsed || parsed.updatedAtMs + refreshThrottleMs < Date.now()) {
      activeLease.updatedAtMs = Date.now();
      await persistLease(activeLease);
    }
  }
}

main().catch((err) => {
  console.error("[wasm-watch] fatal");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
