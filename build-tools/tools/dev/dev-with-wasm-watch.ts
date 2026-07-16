#!/usr/bin/env zx-wrapper
import { spawn, type ChildProcess } from "node:child_process";
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
  onOutput?: (text: string) => void,
): ChildProcess {
  const env = { ...process.env, ...envOverrides };
  const shell = String(env.BASH || "bash").trim() || "bash";
  const child = spawn(shell, ["--noprofile", "--norc", "-lc", command], {
    cwd,
    env,
    stdio: "pipe",
    detached: true,
  });
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk || "");
    onOutput?.(text);
    process.stdout.write(`[${name}] ${text}`);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk || "");
    onOutput?.(text);
    process.stderr.write(`[${name}] ${text}`);
  });
  return child;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

async function waitForInitialWasmSync(watch: ChildProcess, ready: Promise<void>) {
  const timeoutMs = Math.max(30_000, Number(getFlagStr("startup-wasm-timeout-ms", "120000")));
  const startedAt = Date.now();
  await Promise.race([
    ready,
    new Promise<never>((_, reject) =>
      watch.once("exit", (code) =>
        reject(
          new Error(`wasm watcher exited before initial sync completed (code=${String(code)})`),
        ),
      ),
    ),
    sleep(timeoutMs).then(() => {
      throw new Error(`timed out waiting for initial wasm sync after ${timeoutMs}ms`);
    }),
  ]);
  console.error(`[dev-wasm] startup:ready elapsed_ms=${Date.now() - startedAt}`);
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

  let readyOutput = "";
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const watch = spawnShell("wasm-watch", watchCmd, cwd, childEnv, (text) => {
    readyOutput = `${readyOutput}${text}`.slice(-4096);
    if (readyOutput.includes("[wasm-watch] coordinator:ready ")) markReady();
  });
  let vite: ChildProcess | null = null;
  let stopping = false;
  let sawFailure = false;

  const stopAll = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    if (vite) killGroup(vite, signal);
    killGroup(watch, signal);
    setTimeout(() => {
      if (vite) killGroup(vite, "SIGKILL");
      killGroup(watch, "SIGKILL");
    }, 3000).unref();
  };

  process.once("SIGINT", () => stopAll("SIGINT"));
  process.once("SIGTERM", () => stopAll("SIGTERM"));
  process.once("SIGHUP", () => stopAll("SIGHUP"));
  process.once("exit", () => {
    if (stopping) return;
    if (vite) killGroup(vite, "SIGTERM");
    killGroup(watch, "SIGTERM");
  });

  try {
    await waitForInitialWasmSync(watch, ready);
    vite = spawnShell("vite", viteCmd, cwd, childEnv);
  } catch (error) {
    stopAll("SIGTERM");
    throw error;
  }

  const startedVite = vite;
  if (!startedVite) throw new Error("vite process was not started");

  const onExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    const codeStr = code == null ? "null" : String(code);
    const signalStr = signal == null ? "null" : String(signal);
    console.error(`[dev-wasm] ${name} exited code=${codeStr} signal=${signalStr}`);
    if (code !== 0) sawFailure = true;
    stopAll("SIGTERM");
    process.exitCode = sawFailure ? 1 : 0;
  };

  startedVite.once("exit", (code, signal) => onExit("vite", code, signal));
  watch.once("exit", (code, signal) => onExit("wasm-watch", code, signal));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
