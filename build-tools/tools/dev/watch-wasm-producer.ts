#!/usr/bin/env zx-wrapper
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getFlagStr } from "../lib/cli.ts";
import { resolveModuleContractsPaths } from "./module-contract-paths.ts";
import { syncModuleContractsForApp } from "./sync-module-contracts-core.ts";
import {
  specsFromWasmManifest,
  type WasmModuleSpec,
  validateTsManifestProbes,
} from "./wasm-watch-manifest.ts";
import {
  type Fingerprint,
  computeFingerprintMap,
  copyAtomically,
  mapsEqual,
  refreshTriggerPaths,
  refreshWatcherSpecs,
  runBuildStep,
} from "./watch-wasm-producer-ops.ts";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function failLegacyFlags(legacyFlags: string[]): never {
  throw new Error(
    [
      "[wasm-watch] legacy-args:unsupported",
      `[wasm-watch] legacy-args:received ${legacyFlags.join(",")}`,
      "[wasm-watch] migration: remove legacy watcher flags and run `pnpm run dev:wasm:watch` without --watch/--build-cmd/--build-out/--sync-out.",
    ].join("\n"),
  );
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
  const legacyFlags = [watchRaw, buildCmdRaw, buildOutRaw, syncOutRaw]
    .map((value, idx) =>
      String(value || "").trim() !== ""
        ? (["--watch", "--build-cmd", "--build-out", "--sync-out"][idx] as string)
        : "",
    )
    .filter(Boolean);
  const refreshThrottleMs = Math.max(500, Number(getFlagStr("refresh-throttle-ms", "1200")));
  let baseRefreshPaths: string[] = [];
  let refreshState = new Map();
  let lastRefreshAt = 0;
  let generatedContracts = false;
  let generatedAppTarget = "";
  let generatedRoot = "";

  if (legacyFlags.length > 0) failLegacyFlags(legacyFlags);

  if (!wasmManifest && !tsManifest) {
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
    generatedContracts = true;
    generatedAppTarget = resolved.appTargetLabel;
    generatedRoot = resolved.repoRoot;
    wasmManifest = resolved.wasmManifestPath;
    tsManifest = resolved.tsManifestPath;
    console.error(
      `[wasm-watch] contracts:generated app_target=${resolved.appTargetLabel} app_id=${resolved.appId} dir=${resolved.contractsDir}`,
    );
    baseRefreshPaths = uniqueSorted([
      wasmManifest,
      tsManifest,
      path.join(cwd, "TARGETS"),
      path.join(cwd, "package.json"),
      path.join(generatedRoot, "build-tools", "tools", "buck", "graph.json"),
    ]);
  }
  if (!String(wasmManifest || "").trim()) {
    throw new Error("missing required flag --wasm-manifest");
  }
  let specs = await specsFromWasmManifest(cwd, wasmManifest);
  if (wasmManifest) {
    console.error(
      `[wasm-watch] manifest:wasm modules=${specs.length} path=${path.relative(cwd, path.resolve(cwd, wasmManifest)) || "."}`,
    );
  }
  if (tsManifest) {
    const probeLogs = await validateTsManifestProbes(cwd, tsManifest);
    for (const line of probeLogs) console.error(line);
  }
  if (wasmManifest && baseRefreshPaths.length === 0) {
    baseRefreshPaths = uniqueSorted([wasmManifest, tsManifest].filter(Boolean));
  }
  if (baseRefreshPaths.length > 0) {
    refreshState = await computeFingerprintMap(refreshTriggerPaths(baseRefreshPaths, specs));
  }

  let byKey = new Map(specs.map((spec) => [spec.moduleKey, spec]));
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
          const syncOuts = [spec.syncOut, ...(spec.extraSyncOuts || [])];
          let copiedSize = 0;
          for (const outPath of syncOuts) {
            copiedSize = await copyAtomically(spec.buildOut, outPath);
          }
          const elapsed = Date.now() - startedAt;
          console.error(
            `[wasm-watch] sync:ok seq=${seq} module_type=${spec.moduleType} module_key=${moduleKey} bytes=${copiedSize} elapsed_ms=${elapsed} out=${syncOuts.join(",")}`,
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
    if (baseRefreshPaths.length > 0 && Date.now() - lastRefreshAt >= refreshThrottleMs) {
      const triggerPaths = refreshTriggerPaths(baseRefreshPaths, specs);
      const nextRefreshState = await computeFingerprintMap(triggerPaths);
      if (!mapsEqual(refreshState, nextRefreshState)) {
        const startedAt = Date.now();
        console.error("[wasm-watch] refresh:start reason=contracts-or-surface-change");
        try {
          const refreshed = await refreshWatcherSpecs({
            cwd,
            wasmManifest,
            tsManifest,
            specs,
            generated: generatedContracts
              ? { appTargetLabel: generatedAppTarget, root: generatedRoot }
              : null,
            baseRefreshPaths,
            prevByModule,
            pending,
            pendingCoalesced,
            queueBuild,
          });
          specs = refreshed.specs;
          byKey = new Map(specs.map((spec) => [spec.moduleKey, spec]));
          refreshState = refreshed.refreshState;
          if (specs.length > 0) roundRobinStart = roundRobinStart % specs.length;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[wasm-watch] refresh:fail reason=contracts-or-surface-change elapsed_ms=${Date.now() - startedAt}`,
          );
          console.error(msg);
          console.error(
            "[wasm-watch] refresh:recovery: fix module contracts or surface metadata, then rerun `pnpm run dev:wasm:watch`",
          );
        } finally {
          lastRefreshAt = Date.now();
        }
      }
    }
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
