#!/usr/bin/env zx-wrapper
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getFlagStr } from "../lib/cli";
import { syncModuleContractsForApp } from "./sync-module-contracts-core";

function required(name: string, value: string): string {
  const v = String(value || "").trim();
  if (!v) throw new Error(`missing required flag --${name}`);
  return v;
}

function spawnShell(
  name: string,
  command: string,
  cwd: string,
  envOverrides: Record<string, string>,
): ChildProcess {
  const env = { ...process.env, ...envOverrides };
  const shell = String(env.BASH || env.SHELL || "bash").trim() || "bash";
  const child = spawn(shell, ["--noprofile", "--norc", "-lc", command], {
    cwd,
    env,
    stdio: "pipe",
    detached: true,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${String(chunk || "")}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${String(chunk || "")}`));
  return child;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

type WasmModuleManifest = {
  modules?: Array<{
    runtimeDestinations?: {
      client?: string;
      server?: string;
    };
  }>;
};

async function waitForInitialWasmSync(cwd: string, contractsDir: string, watch: ChildProcess) {
  const manifestPath = path.join(contractsDir, "wasm-modules.manifest.json");
  let manifest: WasmModuleManifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8")) as WasmModuleManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read wasm manifest before dev startup: ${message}`);
  }
  const outputs = Array.from(
    new Set(
      (manifest.modules || [])
        .flatMap((module) => [
          String(module.runtimeDestinations?.client || "").trim(),
          String(module.runtimeDestinations?.server || "").trim(),
        ])
        .filter(Boolean)
        .map((rel) => path.resolve(cwd, rel)),
    ),
  );
  if (outputs.length === 0) return;
  const timeoutMs = Math.max(30_000, Number(getFlagStr("startup-wasm-timeout-ms", "120000")));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (watch.exitCode != null) {
      throw new Error(
        `wasm watcher exited before initial sync completed (code=${String(watch.exitCode)})`,
      );
    }
    const states = await Promise.all(outputs.map((abs) => fsp.stat(abs).catch(() => null)));
    if (states.every((st) => st && st.isFile() && st.size > 0)) {
      console.error(
        `[dev-wasm] startup:ready outputs=${outputs.length} elapsed_ms=${Date.now() - startedAt}`,
      );
      return;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for initial wasm sync after ${timeoutMs}ms: ${outputs.join(", ")}`,
  );
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const appTargetLabel = getFlagStr("app-target", "");
  const viteCmd = required("vite-cmd", getFlagStr("vite-cmd", ""));
  const watchCmd = required("watch-cmd", getFlagStr("watch-cmd", ""));
  const synced = await syncModuleContractsForApp({
    appCwd: cwd,
    appTargetLabel: appTargetLabel || undefined,
  });
  const childEnv = {
    MODULE_CONTRACTS_DIR: synced.contractsDir,
  };
  console.error(
    `[dev-wasm] contracts:ready app_target=${synced.appTargetLabel} app_id=${synced.appId} dir=${synced.contractsDir}`,
  );

  const watch = spawnShell("wasm-watch", watchCmd, cwd, childEnv);
  await waitForInitialWasmSync(cwd, synced.contractsDir, watch);
  const vite = spawnShell("vite", viteCmd, cwd, childEnv);
  let stopping = false;
  let sawFailure = false;

  const stopAll = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    killGroup(vite, signal);
    killGroup(watch, signal);
    setTimeout(() => {
      killGroup(vite, "SIGKILL");
      killGroup(watch, "SIGKILL");
    }, 3000).unref();
  };

  process.once("SIGINT", () => stopAll("SIGINT"));
  process.once("SIGTERM", () => stopAll("SIGTERM"));

  const onExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    const codeStr = code == null ? "null" : String(code);
    const signalStr = signal == null ? "null" : String(signal);
    console.error(`[dev-wasm] ${name} exited code=${codeStr} signal=${signalStr}`);
    if (code !== 0) sawFailure = true;
    stopAll("SIGTERM");
    process.exitCode = sawFailure ? 1 : 0;
  };

  vite.once("exit", (code, signal) => onExit("vite", code, signal));
  watch.once("exit", (code, signal) => onExit("wasm-watch", code, signal));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
