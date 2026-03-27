#!/usr/bin/env zx-wrapper
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { syncModuleContractsForApp } from "./sync-module-contracts-core.ts";

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

  const vite = spawnShell("vite", viteCmd, cwd, childEnv);
  const watch = spawnShell("wasm-watch", watchCmd, cwd, childEnv);
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
